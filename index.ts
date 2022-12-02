import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as config from "./config";

const vpc = new awsx.ec2.Vpc("vpc", {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 2,
    subnetSpecs: [{
        type: awsx.ec2.SubnetType.Public,
        name: "public-ecs-subnet",
    }, {
        type: awsx.ec2.SubnetType.Private,
        name: "private-ecs-subnet"
    }],
    tags: {
        name: "pk-ecs-demo"
    },
    natGateways: {
        strategy: "None"
    },
    enableDnsHostnames: true,
    enableDnsSupport: true
});

const repo = new awsx.ecr.Repository("repo");

const image = new awsx.ecr.Image("app-image", {
    repositoryUrl: repo.url,
    path: "./app"
});

const cluster = new aws.ecs.Cluster("cluster");

const lbSecurityGroup = new aws.ec2.SecurityGroup("lbSg", {
    vpcId: vpc.vpcId,
    ingress: [{
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: ["0.0.0.0/0"]
    },
    {
        protocol: "tcp",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"]
    }],
    egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"]
    }]
});

const endpointSG = new aws.ec2.SecurityGroup("endpointSg", {
    vpcId: vpc.vpcId,
    egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"]
    }]
});

const taskSecurityGroup = new aws.ec2.SecurityGroup("taskSg", {
    vpcId: vpc.vpcId,
    ingress: [{
        protocol: "tcp",
        fromPort: 3000,
        toPort: 3000,
        securityGroups: [lbSecurityGroup.id]
    }],
    egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"]
    }, {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        securityGroups: [endpointSG.id]
    }]
});

const endpointSgRule = new aws.ec2.SecurityGroupRule("endpointSgRule", {
    securityGroupId: endpointSG.id,
    fromPort: 0,
    toPort: 0,
    protocol: "-1",
    sourceSecurityGroupId: taskSecurityGroup.id,
    type: "ingress"
})

const ecrApiVpcInterface = new aws.ec2.VpcEndpoint("ecrApiVpcInterface", {
    dnsOptions: {
        dnsRecordIpType: "ipv4",
    },
    ipAddressType: "ipv4",
    policy: "{\"Statement\":[{\"Action\":\"*\",\"Effect\":\"Allow\",\"Principal\":\"*\",\"Resource\":\"*\"}]}",
    privateDnsEnabled: true,
    serviceName: "com.amazonaws.eu-west-1.ecr.api",
    subnetIds: vpc.privateSubnetIds,
    vpcEndpointType: "Interface",
    vpcId: vpc.vpcId,
    securityGroupIds: [endpointSG.id]
});

const ecrDkVpcInterface = new aws.ec2.VpcEndpoint("ecrDkVpcInterface", {
    dnsOptions: {
        dnsRecordIpType: "ipv4",
    },
    ipAddressType: "ipv4",
    policy: "{\"Statement\":[{\"Action\":\"*\",\"Effect\":\"Allow\",\"Principal\":\"*\",\"Resource\":\"*\"}]}",
    privateDnsEnabled: true,
    serviceName: "com.amazonaws.eu-west-1.ecr.dkr",
    subnetIds: vpc.privateSubnetIds,
    vpcEndpointType: "Interface",
    vpcId: vpc.vpcId,
    securityGroupIds: [endpointSG.id]
});

const s3Endpoint = new aws.ec2.VpcEndpoint("s3Endpoint", {
    policy: "{\"Statement\":[{\"Action\":\"*\",\"Effect\":\"Allow\",\"Principal\":\"*\",\"Resource\":\"*\"}],\"Version\":\"2008-10-17\"}",
    routeTableIds: vpc.routeTables.apply(x => x.map(x => x.id)),
    serviceName: "com.amazonaws.eu-west-1.s3",
    vpcId: vpc.vpcId,
});

const lb = new aws.lb.LoadBalancer("lb", {
    securityGroups: [lbSecurityGroup.id],
    subnets: vpc.publicSubnetIds,
    loadBalancerType: "application",
});

const tg = new aws.lb.TargetGroup("tg", {
    port: 3000,
    protocol: "HTTP",
    targetType: "ip",
    vpcId: vpc.vpcId,
    deregistrationDelay: 5
}, { dependsOn: lb });

const lbRecord = new aws.route53.Record("lbRecord", {
    name: config.subDomain,
    type: "CNAME",
    records: [lb.dnsName],
    ttl: 60,
    zoneId: config.hostedZoneId
})

const cert = new aws.acm.Certificate("cert", {
    domainName: config.subDomain,
    validationMethod: "DNS"
});

const validationRecord = new aws.route53.Record("validationRecord", {
    name: cert.domainValidationOptions[0].resourceRecordName,
    ttl: 60,
    records: [cert.domainValidationOptions[0].resourceRecordValue],
    type: cert.domainValidationOptions[0].resourceRecordType,
    zoneId: config.hostedZoneId
});

const certValidation = new aws.acm.CertificateValidation("certValidation", {
    certificateArn: cert.arn,
    validationRecordFqdns: [validationRecord.fqdn]
})

const httpsListener = new aws.lb.Listener("httpsListener", {
    loadBalancerArn: lb.arn,
    certificateArn: cert.arn,
    port: 443,
    defaultActions: [{
        type: "forward",
        targetGroupArn: tg.arn
    }],
    protocol: "HTTPS",
}, { dependsOn: [certValidation] });

const httpListener = new aws.lb.Listener("httpListener", {
    loadBalancerArn: lb.arn,
    port: 80,
    defaultActions: [{
        type: "redirect",
        redirect: {
            port: "443",
            protocol: "HTTPS",
            statusCode: "HTTP_301"
        }
    }]
}, { dependsOn: [httpsListener] })

const role = new aws.iam.Role("role", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal(aws.iam.Principals.EcsTasksPrincipal),
    managedPolicyArns: [aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy]
});

const logGroup = new aws.cloudwatch.LogGroup("app-loggroup");

// const fargatetd = new awsx.ecs.FargateTaskDefinition("fargate", {
//     family: "app-demop",
//     cpu: "1024",
//     memory: "2048",
//     container: [{
//         name: "app",
//         image: image.imageUri,
        
//     }]
// })

const appTd = new aws.ecs.TaskDefinition("appTd", {
    family: "app-demo",
    cpu: "1024",
    memory: "2048",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: role.arn,
    taskRoleArn: role.arn,
    containerDefinitions: pulumi.all([image.imageUri, logGroup.name]).apply(([imageUri, logGroupName]) => JSON.stringify([{
        name: "app",
        image: imageUri,
        portMappings: [{
            containerPort: 3000,
            protocol: "tcp",
        }],
        logConfiguration: {
            logDriver: "awslogs",
            options: {
                "awslogs-create-group": "true",
                "awslogs-group": logGroupName,
                "awslogs-region": "eu-west-1",
                "awslogs-stream-prefix": "app"
            }
        }
    }]))
});

const nativeAppService = new aws.ecs.Service("native-app-service", {
    cluster: cluster.arn,
    desiredCount: 1,
    launchType: "FARGATE",
    taskDefinition: appTd.arn,
    networkConfiguration: {
        assignPublicIp: false,
        subnets: vpc.privateSubnetIds,
        securityGroups: [taskSecurityGroup.id]
    },
    loadBalancers: [{
        containerName: "app",
        containerPort: 3000,
        targetGroupArn: tg.arn
    }],
    deploymentMaximumPercent: 200,
    deploymentMinimumHealthyPercent: 100
});

