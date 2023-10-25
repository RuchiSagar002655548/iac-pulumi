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

// Get the AWS profile from the config
const awsProfile = awsConfig.require("profile");

// Get AWS region from configuration
const region =  awsConfig.require("region") as aws.Region

const vpcName = config.require("vpcName");
const rdsName = config.require("identifier");
const intClass = config.require("instanceClass");
const engVersion = config.require("engineVersion");
const storageType = config.require("storageType");
const eng = config.require("engine");
const databaseName = config.require("dbName");
const publicCidrBlockName = config.require("publicCidrBlockName");
const parameterGroupName = config.require("parameterGroupName");
const internetGatewayName = config.require("internetGatewayName");
const publicRouteTableName = config.require("publicRouteTableName");
const privateRouteTableName = config.require("privateRouteTableName");
// Get other configurations
const vpcCidrBlock = config.require("vpcCidrBlock");
const subnetMask = config.require("subnetMask");
const amiId = config.require("amiId");
const keyPair = config.require("keyPair");
const dbUsername = config.requireSecret("dbUsername");
const dbPassword = config.requireSecret("dbPassword");


// Declare separate arrays for public and private subnets
const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];

// Configure AWS provider with the specified region
const provider = new aws.Provider("provider", {
    region: region,
    profile: awsProfile,
});

// This will create a VPC
const vpc = new aws.ec2.Vpc(vpcName, {
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: vpcName,
    },
}, { provider });


// To Query the number of availability zones in the specified region
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

// Create an EC2 security group for web applications
const appSecurityGroup = new aws.ec2.SecurityGroup("app-sg", {
    vpcId: vpc.id,
    description: "Application Security Group",
    ingress: [
        // Allow SSH (22) traffic 
        {
            protocol: "tcp",
            fromPort: 22,
            toPort: 22,
            cidrBlocks: [publicCidrBlockName]
        },
        // Allow HTTP (80) traffic
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: [publicCidrBlockName]
        },
        // Allow HTTPS (443) traffic 
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks:[publicCidrBlockName]
        },
        // Replace 3000 with the port your application runs on
        {
            protocol: "tcp",
            fromPort: 3000,
            toPort: 3000,
            cidrBlocks: [publicCidrBlockName]
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
            securityGroups: [appSecurityGroup.id]  // This will only allows traffic from the application security group
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
const dbSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", {
    subnetIds: privateSubnetIds,
    tags: {
        Name: "db-subnet-group",
    },
}, { provider });

const dbInstance = new aws.rds.Instance("mydbinstance", {
    instanceClass: intClass,
    dbSubnetGroupName: dbSubnetGroup.name, 
    parameterGroupName: dbParameterGroup.name, 
    engine: eng,
    engineVersion: engVersion, 
    allocatedStorage: 20,
    storageType: storageType,
    username: "dbUsername",
    password: "dbPassword",
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
ENV_FILE="/home/admin/webapp/.env"

# Create or overwrite the environment file with the environment variables
echo "DBHOST=${endpoint_host}" > $ENV_FILE
echo "DBPORT=${dbPort}" >> $ENV_FILE
echo "DBUSER=${username}" >> $ENV_FILE
echo "DBPASS=${password}" >> $ENV_FILE
echo "DATABASE=${databaseName}" >> $ENV_FILE

# Optionally, you can change the owner and group of the file if needed
sudo chown ec2-user:ec2-group $ENV_FILE

# Adjust the permissions of the environment file
sudo chmod 600 $ENV_FILE
`;
});

// Create an EC2 instance
const ec2Instance = new aws.ec2.Instance("web-app-instance", {
    ami: amiId,
    instanceType: "t2.micro",
    vpcSecurityGroupIds: [appSecurityGroup.id],  // attach application security group
    subnetId: pulumi.output(publicSubnetIds[0]),  // specify one of the public subnets
    associatePublicIpAddress: true,
    keyName: keyPair, 
    disableApiTermination: false,  // allows the instance to be terminated
    rootBlockDevice: {
        deleteOnTermination: true,  // ensure the EBS volume is deleted upon termination
        volumeSize: 25, // set the root volume size to 25 GB
        volumeType: "gp2", // set the root volume type to General Purpose SSD (GP2)
    },
    tags: {
        Name: "web-app-instance",
    },
    userData: userData,
}, { dependsOn: publicSubnets}); 


// Export the security group ID
export const securityGroupId = appSecurityGroup.id;

export const internetGatewayId = internetGateway.id;
export const publicRouteTableId = publicRouteTable.id;
export const privateRouteTableId = privateRouteTable.id;
// Export the public IP of the instance
export const publicIp = ec2Instance.publicIp;
// Export the rds security group ID
export const rdsSecurityGroupId = rdsSecurityGroup.id;