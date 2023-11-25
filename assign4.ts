import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";


function calculateSubnetCidrBlock(vpcCidrBlock: string, subnetIndex: number,  totalSubnets: number): string {
    const cidrParts = vpcCidrBlock.split('/');
    const ipParts = cidrParts[0].split('.').map(part => parseInt(part, 10));
    
    // Increment the third octet based on the subnet index
    ipParts[2] += subnetIndex;

    if (ipParts[2] > 255) {
        // Handle this case accordingly; in this example, we're throwing an error
        throw new Error('Exceeded the maximum number of subnets for the given VPC CIDR block');
    }

    const subnetIp = ipParts.join('.');
    return `${subnetIp}/${subnetMask}`;  // Use /24 subnet mask for each subnet
}


// Load configurations
const config = new pulumi.Config("myfirstpulumi");
const awsConfig = new pulumi.Config("aws");
const gcpConfig = new pulumi.Config("gcp");

//const domainName = config.require("domainName"); 
//const hostedZoneId = config.require("hostedZoneId");

// Get the AWS profile from the config
const awsProfile = awsConfig.require("profile");

// Get AWS region from configuration
const region =  awsConfig.require("region") as aws.Region
const gcpRegion =  gcpConfig.require("region") 
const gcpProjectId =  gcpConfig.require("project") 
const vpcName = config.require("vpcName");
const rdsName = config.require("identifier");
const intClass = config.require("instanceClass");
const engVersion = config.require("engineVersion");
const storageType = config.require("storageType");
const eng = config.require("engine");
const databaseName = config.require("dbName");
const publicCidrBlockName = config.require("publicCidrBlockName");
const myParameterGroupName = config.require("myParameterGroupName");
const internetGatewayName = config.require("internetGatewayName");
const publicRouteTableName = config.require("publicRouteTableName");
const privateRouteTableName = config.require("privateRouteTableName");

// Get other configurations
const vpcCidrBlock = config.require("vpcCidrBlock");
const domainName = config.require("domainName"); 
const hostedZoneId = config.require("hostedZoneId");
const subnetMask = config.require("subnetMask");
const amiId = config.require("amiId");
const keyPair = config.require("keyPair");
const dbUsername = config.requireSecret("dbUsername");
const dbPassword = config.requireSecret("dbPassword");
const accountId = config.require("accountId");
const applicationPort = parseInt(config.require("applicationPort"), 10);
const snsTopicName = config.require("snsTopicName"); 
const bucketAccountId = config.require("bucketAccountId");
const bucketDisplayName = config.require("bucketDisplayName");
const gcpBucketName = config.require("gcpBucketName");
const location = config.require("location");

// Declare separate arrays for public and private subnets
const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];

// Configure AWS provider with the specified region
const provider = new aws.Provider("provider", {
    region: region,
    profile: awsProfile,
});

// Create a VPC
const vpc = new aws.ec2.Vpc(vpcName, {
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: vpcName,
    },
}, { provider });


// Query the number of availability zones in the specified region
const azs = pulumi.output(aws.getAvailabilityZones());

// Create subnets dynamically based on the number of availability zones (up to 3)
const subnets = azs.apply((azs) =>
  azs.names.slice(0, 3).flatMap((az, index) => {
    const publicSubnetCidrBlock = calculateSubnetCidrBlock(
      vpcCidrBlock,
      index,
      3
    );
    const privateSubnetCidrBlock = calculateSubnetCidrBlock(
      vpcCidrBlock,
      index + 3,
      3
    );

// Create subnets dynamically based on the number of availability zones (up to 3)
    const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: publicSubnetCidrBlock,
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
        tags: {
            Name: `PublicSubnet-${index}`, 
        },
    }, { provider });

    const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: privateSubnetCidrBlock,
        availabilityZone: az,
        mapPublicIpOnLaunch: false,
        tags: {
            Name: `PrivateSubnet-${index}`, 
        },
    }, { provider });


    // Pushing the subnets to their respective arrays
    publicSubnets.push(publicSubnet);
    privateSubnets.push(privateSubnet);

    return [publicSubnet, privateSubnet];
}));

// Create an Internet Gateway and attach it to the VPC
const internetGateway = new aws.ec2.InternetGateway(internetGatewayName, {
    vpcId: vpc.id,
    tags: {
        Name: internetGatewayName,  
    },
}, { provider });

// Create a Public Route Table with a route to the Internet Gateway
const publicRouteTable = new aws.ec2.RouteTable( publicRouteTableName, {
    vpcId: vpc.id,
    tags: {
        Name:  publicRouteTableName,  
    },
    routes: [{
        cidrBlock: publicCidrBlockName,
        gatewayId: internetGateway.id,
    }],
}, { provider });

// Associate each public subnet with the Public Route Table
subnets.apply(subnetArray => 
    subnetArray.filter((_, index) => index % 2 === 0)
    .forEach(subnet => 
        subnet.id.apply(id => 
            new aws.ec2.RouteTableAssociation(`publicRtAssoc-${id}`, {
                subnetId: id,
                routeTableId: publicRouteTable.id,
            }, { provider })
        )
    )
);

// Create a Private Route Table 
const privateRouteTable = new aws.ec2.RouteTable( privateRouteTableName, {
    vpcId: vpc.id,
    tags: {
        Name:  privateRouteTableName,  
    },
}, { provider });

// Associate each private subnet with the Private Route Table
subnets.apply(subnetArray => 
    subnetArray.filter((_, index) => index % 2 !== 0)
    .forEach(subnet => 
        subnet.id.apply(id => 
            new aws.ec2.RouteTableAssociation(`privateRtAssoc-${id}`, {
                subnetId: id,
                routeTableId: privateRouteTable.id,
                // You can add tags here as well if needed
            }, { provider })
        )
    )
);

const lbSecurityGroup = new aws.ec2.SecurityGroup("lb-sg", {
    vpcId: vpc.id,
    description: "Load Balancer Security Group",
    ingress: [
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: [publicCidrBlockName]
        },
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks: [publicCidrBlockName]
        },
    ],
    egress: [
        // Allow all outgoing traffic from the load balancer
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [publicCidrBlockName]
        },
    ],
    tags: {
        Name: "LoadBalancerSecurityGroup",
    },
}, { provider });


// Create an EC2 security group for web applications
const appSecurityGroup = new aws.ec2.SecurityGroup("app-sg", {
    vpcId: vpc.id,
    description: "Application Security Group",
    ingress: [
        // Allow SSH (22) and application Port traffic from the load balancer security group
        {
            protocol: "tcp",
            fromPort: 22,
            toPort: 22,
            securityGroups: [lbSecurityGroup.id] 
        },
        // Allow Application traffic from the load balancer security group
        {
            protocol: "tcp",
            fromPort: applicationPort,
            toPort: applicationPort,
            securityGroups: [lbSecurityGroup.id]
        }
    ],
    egress: [
        // Allow all outgoing traffic
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [publicCidrBlockName]
        }
    ],
});

// Create an EC2 security group for RDS instances
const rdsSecurityGroup = new aws.ec2.SecurityGroup("rds-sg", {
    vpcId: vpc.id,
    description: "RDS Security Group",
    ingress: [
        // Allow MySQL/MariaDB (3306) traffic or PostgreSQL (5432) traffic from the application security group
        {
            protocol: "tcp",
            fromPort: 3306,  
            toPort: 3306,    
            securityGroups: [appSecurityGroup.id]  // Only allows traffic from the application security group
        }
    ],
    egress: [
        // Restrict all outgoing internet traffic
        {
            protocol: "tcp",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [publicCidrBlockName]
            
        }
    ],
}, { provider });


// Export the IDs of the resources created
export const vpcId = vpc.id;
export const publicSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 === 0).map(subnet => subnet.id)
);
export const privateSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 !== 0).map(subnet => subnet.id)
);

const dbParameterGroup = new aws.rds.ParameterGroup(parameterGroupName, {
    family: "mariadb10.5",
    description: "Custom parameter group for mariadb10.5",
    parameters: [{
        name: "max_connections",
        value: "100"
    }]
}, { provider });


// Creating a DB subnet group
const dbSubnetGroup = new aws.rds.SubnetGroup("dbsubnetgrp", {
    subnetIds: privateSubnetIds,
    tags: {
        Name: "dbsubnetgrp",
    },
}, { provider });

// Create an RDS instance with MariaDB
const dbInstance = new aws.rds.Instance("mydbinstance", {
    instanceClass: intClass,
    dbSubnetGroupName: dbSubnetGroup.name, 
    parameterGroupName: dbParameterGroup.name, 
    engine: eng,
    engineVersion: engVersion, 
    allocatedStorage: 20,
    storageType: storageType,
    username: dbUsername,
    password: dbPassword,
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [rdsSecurityGroup.id],
    publiclyAccessible: false,
    identifier: rdsName,
    dbName: databaseName

}, { provider });

const userData = pulumi.all([dbInstance.endpoint, dbUsername, dbPassword,databaseName]).apply(([endpoint, username, password,databaseName]) => {
    const parts = endpoint.split(':');
    const endpoint_host = parts[0];
    const dbPort = parts[1];
    
    // Create the bash script string
    return `#!/bin/bash
ENV_FILE="/home/ec2-user/webapp/.env"

# Create or overwrite the environment file with the environment variables
echo "DBHOST=${endpoint_host}" > $ENV_FILE
echo "DBPORT=${dbPort}" >> $ENV_FILE
echo "DBUSER=${username}" >> $ENV_FILE
echo "DBPASS=${password}" >> $ENV_FILE
echo "DATABASE=${databaseName}" >> $ENV_FILE
echo "CSV_PATH=/home/ec2-user/webapp/users.csv" >> $ENV_FILE
echo "PORT=3000" >> $ENV_FILE

# Optionally, you can change the owner and group of the file if needed
sudo chown ec2-user:ec2-group $ENV_FILE

# Adjust the permissions of the environment file
sudo chmod 600 $ENV_FILE

# Configure and restart the CloudWatch Agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s
sudo systemctl restart amazon-cloudwatch-agent
`;
});

const cloudWatchAgentServerPolicy = new aws.iam.Policy("cloudWatchAgentServerPolicy", {
    description: "A policy that allows sending logs to CloudWatch",
    policy: JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "cloudwatch:PutMetricData",
                    "ec2:DescribeVolumes",
                    "ec2:DescribeTags",
                    "logs:PutLogEvents",
                    "logs:DescribeLogStreams",
                    "logs:DescribeLogGroups",
                    "logs:CreateLogStream",
                    "logs:CreateLogGroup",
                    "elasticloadbalancing:Describe*",
                    "autoscaling:DescribeAutoScalingGroups",
                    "autoscaling:DescribeAutoScalingInstances",
                    "autoscaling:DescribeLaunchConfigurations",
                    "autoscaling:DescribePolicies",
                ],
                "Resource": "*"
            },
            {
                "Effect": "Allow",
                "Action": [
                    "ssm:GetParameter"
                ],
                "Resource": "arn:aws:ssm:*:*:parameter/AmazonCloudWatch-*"
            }
        ]
    }),
});

const role = new aws.iam.Role("cloudWatchAgentRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Principal: {
                Service: "ec2.amazonaws.com",
            },
            Effect: "Allow",
        }],
    }),
});

new aws.iam.RolePolicyAttachment("cloudWatchAgentRoleAttachment", {
    role: role.name,
    policyArn: cloudWatchAgentServerPolicy.arn,
});

// Create an IAM instance profile that references the IAM role
const instanceProfile = new aws.iam.InstanceProfile("cloudWatchAgentInstanceProfile", {
    role: role.name,
});

const appLoadBalancer = new aws.lb.LoadBalancer("appLoadBalancer", {
    internal: false,
    securityGroups: [lbSecurityGroup.id],
    subnets: publicSubnetIds, 
    enableDeletionProtection: false,
});

const targetGroup = new aws.lb.TargetGroup("targetGroup", {
    port: applicationPort, // Assuming your app listens on port 3000
    protocol: "HTTP",
    vpcId: vpcId,
    targetType: "instance",
    healthCheck: {
        enabled: true,
        path: "/healthz"
    },
});

const listener = new aws.lb.Listener("listener", {
    loadBalancerArn: appLoadBalancer.arn,
    port: 80,
    defaultActions: [{
        type: "forward",
        targetGroupArn: targetGroup.arn,
    }],
});

const launchTemplate = new aws.ec2.LaunchTemplate("launch_template", {
    imageId: amiId,
    instanceType: "t2.micro",
    keyName: keyPair,
    networkInterfaces: [{
        associatePublicIpAddress: "true",
        securityGroups: [appSecurityGroup.id],
    }],
    userData: userData.apply(ud => Buffer.from(ud).toString('base64')),
    iamInstanceProfile: {
        name: instanceProfile.name,
    },
});
   
const autoScalingGroup = new aws.autoscaling.Group("webAppAutoScalingGroup", {
    maxSize: 3,
    minSize: 1,
    desiredCapacity: 1,
    vpcZoneIdentifiers: pulumi.output(publicSubnetIds),
    launchTemplate: {
        id: launchTemplate.id,
        version: '$Latest',
    },
    tags: [{
        key: "Name",
        value: "web-app",
        propagateAtLaunch: true,
    }, {
        key: "AutoScalingGroup",
        value: "TagProperty",
        propagateAtLaunch: true,
    }],
    defaultCooldown: 60,
    targetGroupArns: [targetGroup.arn],
}, { dependsOn: publicSubnets});

const scaleUpPolicy = new aws.autoscaling.Policy("scaleUp", {
    autoscalingGroupName: autoScalingGroup.name,
    cooldown: 60,
    adjustmentType: "ChangeInCapacity",
    scalingAdjustment: 1,
    metricAggregationType: "Average",
    policyType: "SimpleScaling",
    // You would typically use CloudWatch Alarms to trigger this policy
});

const scaleDownPolicy = new aws.autoscaling.Policy("scaleDown", {
    autoscalingGroupName: autoScalingGroup.name,
    cooldown: 60,
    adjustmentType: "ChangeInCapacity",
    scalingAdjustment: -1,
    metricAggregationType: "Average",
    policyType: "SimpleScaling",
    // You would typically use CloudWatch Alarms to trigger this policy
});

const cpuHighAlarm = new aws.cloudwatch.MetricAlarm("cpuHighAlarm", {
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    statistic: "Average",
    period: 60,
    evaluationPeriods: 1,
    threshold: 3,
    comparisonOperator: "GreaterThanThreshold",
    alarmActions: [scaleUpPolicy.arn],
    dimensions: {
        AutoScalingGroupName: autoScalingGroup.name,
    },
});

const cpuLowAlarm = new aws.cloudwatch.MetricAlarm("cpuLowAlarm", {
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    statistic: "Average",
    period: 60,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "LessThanThreshold",
    alarmActions: [scaleDownPolicy.arn],
    dimensions: {
        AutoScalingGroupName: autoScalingGroup.name,
    },
});

const aRecord = new aws.route53.Record("aRecord", {
    zoneId: hostedZoneId,
    name: domainName,
    type: "A",
    aliases: [{
        name: pulumi.interpolate`${appLoadBalancer.dnsName}`,
        zoneId: appLoadBalancer.zoneId,
        evaluateTargetHealth: true,
    }],
}, { provider });

// Export the security group ID
export const securityGroupId = appSecurityGroup.id;
export const internetGatewayId = internetGateway.id;
export const publicRouteTableId = publicRouteTable.id;
export const privateRouteTableId = privateRouteTable.id;

// Export the rds security group ID
export const rdsSecurityGroupId = rdsSecurityGroup.id;
export const recordName = aRecord.name;
export const recordType = aRecord.type;
export const lbSecurityGroupId = lbSecurityGroup.id;