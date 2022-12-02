import * as pulumi from "@pulumi/pulumi";

const stackConfig = new pulumi.Config();

const subDomain = stackConfig.require("domainRecord");
const hostedZoneId = stackConfig.require("hostedZoneId");

export {
    subDomain, 
    hostedZoneId
};
