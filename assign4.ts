import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as crypto from "crypto";



// Load configurations
const config = new pulumi.Config("myfirstpulumi");
const awsConfig = new pulumi.Config("aws");


// Get the AWS profile from the config
const awsProfile = awsConfig.require("profile");

// Get AWS region from configuration
const region =  awsConfig.require("region") as aws.Region

const vpcName = config.require("vpcName");
const publicCidrBlockName = config.require("publicCidrBlockName");
const internetGatewayName = config.require("internetGatewayName");
const publicRouteTableName = config.require("publicRouteTableName");
const privateRouteTableName = config.require("privateRouteTableName");
const subnetMask = config.require("subnetMask");
const vpcCidrBlock = config.require("vpcCidrBlock");


function calculateCIDR(vpcCidrBlock: string, subnetIndex: number,  totalSubnets: number): string {
    const cidrParts = vpcCidrBlock.split('/');
    const ip = cidrParts[0].split('.').map(part => parseInt(part, 10));
    
    // Increment the third octet based on the subnet index
    ip[2] += subnetIndex;

    if (ip[2] > 255) {
        // Handle this case accordingly; in this example, we're throwing an error
        throw new Error('Exceeded the maximum number of subnets');
    }

    const subnetIp = ip.join('.');
    return `${subnetIp}/${subnetMask}`;  
}


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
    const uniqueIdentifier = crypto.randomBytes(4).toString("hex"); // Generate a unique identifier
    const publicSubnetCidrBlock = calculateCIDR(
      vpcCidrBlock,
      index,
      3
    );
    const privateSubnetCidrBlock = calculateCIDR(
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
            Name: `PublicSubnet-${az}-${vpcName}-${uniqueIdentifier}`, 
        },
    }, { provider });

    const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: privateSubnetCidrBlock,
        availabilityZone: az,
        mapPublicIpOnLaunch: false,
        tags: {
            Name: `PrivateSubnet-${az}-${vpcName}-${uniqueIdentifier}`, 
        },
    }, { provider });

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


// Export the IDs of the resources created
export const vpcId = vpc.id;
export const publicSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 === 0).map(subnet => subnet.id)
);
export const privateSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 !== 0).map(subnet => subnet.id)
);

export const internetGatewayId = internetGateway.id;
export const publicRouteTableId = publicRouteTable.id;
export const privateRouteTableId = privateRouteTable.id;