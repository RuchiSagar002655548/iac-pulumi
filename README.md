# iac-pulumi

# AWS Networking Infrastructure Setup with Pulumi

This project involves setting up a robust AWS networking infrastructure using Pulumi, a modern infrastructure as code tool. The setup includes creating a VPC, subnets, route tables, and an internet gateway, ensuring that values are not hardcoded and the code can be reused to create multiple VPCs.

## Prerequisites

-AWS CLI installed and configured with dev and demo profiles.
-Pulumi installed.
-Node.js installed (if using JavaScript/TypeScript).

## AWS CLI Configuration

aws configure --profile dev
aws configure --profile demo

## Pulumi Configuration

Navigate to the Pulumi project directory and set up configurations. Replace placeholders with actual values.

pulumi config set vpcCidrBlock <vpc-cidr-block>
pulumi config set publicSubnetCidrBlocks '[<public-subnet1-cidr-block>, <public-subnet2-cidr-block>, <public-subnet3-cidr-block>]'
pulumi config set privateSubnetCidrBlocks '[<private-subnet1-cidr-block>, <private-subnet2-cidr-block>, <private-subnet3-cidr-block>]'
pulumi config set availabilityZones '["us-east-1a", "us-east-1b", "us-east-1c"]'

## Deploying Infrastructure

After setting up the configurations, deploy the infrastructure using Pulumi.

pulumi up

## Infrastructure Components

VPC: A Virtual Private Cloud to house your resources.
Subnets: Three public and three private subnets spread across three different availability zones.
Internet Gateway: Attached to the VPC to enable communication between resources in the VPC and the internet.
Route Tables: Separate public and private route tables associated with the respective subnets.
Routes: A public route added to the public route table to direct traffic through the internet gateway.

## Code Structure

The index.ts file contains the main code to create the AWS resources. All values are fetched from the Pulumi configuration, ensuring no hardcoding and reusability of code.

import _ as pulumi from "@pulumi/pulumi";
import _ as aws from "@pulumi/aws";

// Fetching configuration values
// Creating AWS resources
// Exporting resource IDs and attributes as needed

## Cleanup

// To avoid incurring additional costs, destroy the resources once done.
pulumi destroy

// Then, remove the stack.
pulumi stack rm
