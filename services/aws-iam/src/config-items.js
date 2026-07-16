'use strict'

const awsConfigItems = [
  {
    name: 'authenticationMethod',
    displayName: 'Authentication Method',
    type: 'CHOICE',
    required: true,
    shared: false,
    defaultValue: 'API Key',
    hint: "How to authenticate with AWS. 'API Key' uses your access key directly. 'IAM Role' uses STS AssumeRole with a Role ARN for cross-account access.",
    options: ['API Key', 'IAM Role'],
  },
  {
    name: 'region',
    displayName: 'Region',
    type: 'STRING',
    required: true,
    shared: false,
    defaultValue: 'us-east-1',
    hint: 'AWS region code, e.g. us-east-1. IAM is a global service that is always signed for us-east-1; this region is only used when assuming an IAM Role via STS.',
  },
  {
    name: 'accessKeyId',
    displayName: 'Access Key',
    type: 'STRING',
    required: false,
    shared: false,
    hint: 'Your AWS access key ID. Required for both API Key and IAM Role authentication.',
  },
  {
    name: 'secretAccessKey',
    displayName: 'Secret Key',
    type: 'STRING',
    required: false,
    shared: false,
    hint: 'Your AWS secret access key. Required for both API Key and IAM Role authentication.',
  },
  {
    name: 'roleArn',
    displayName: 'IAM Role ARN',
    type: 'STRING',
    required: false,
    shared: false,
    hint: 'ARN of the IAM role to assume (e.g. arn:aws:iam::123456789012:role/MyRole). Required for IAM Role authentication.',
  },
  {
    name: 'externalId',
    displayName: 'External ID',
    type: 'STRING',
    required: false,
    shared: false,
    hint: 'Optional external ID for cross-account role assumption.',
  },
]

module.exports = { awsConfigItems }
