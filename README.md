# Pulumi Fargate demo

Add the following config settings:

1. `pulumi config set aws:region {AWS REGION TO DEPLOY TO}`
1. `pulumi config set domainRecord {DOMAIN RECORD THAT YOU WANT TO USE}` // i.e. demo.mydomain.com
1. `pulumi config set hostedZoneId {Route53 Hosted zone that you want to set the above record in}`

Run:

`pulumi up`