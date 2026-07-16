# AWS IAM FlowRunner Extension

Manage AWS Identity and Access Management (IAM) entities — users, groups, roles, managed policies, and access keys — plus account-level information, using zero-dependency native SigV4 request signing.

## Ideal Use Cases

- Provision new IAM users and programmatic access keys as part of an onboarding automation
- Attach or detach managed policies on users and roles to grant or revoke permissions on demand
- Manage group membership to apply permission sets consistently across teams
- Rotate access keys by creating a new key, deactivating the old one, then deleting it
- Audit account posture by listing users, groups, roles, and pulling an IAM account summary

## List of Actions

- **Users** — List Users, Get User, Create User, Delete User, List Access Keys, Create Access Key, Update Access Key, Delete Access Key
- **Groups** — List Groups, Get Group, Create Group, Delete Group, Add User To Group, Remove User From Group, List Groups For User
- **Roles** — List Roles, Get Role, Create Role, Delete Role, List Attached Role Policies
- **Policies** — List Policies, Get Policy, Create Policy, Delete Policy, Attach User Policy, Detach User Policy, Attach Role Policy, Detach Role Policy
- **Account** — Get Account Summary, List Account Aliases

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

IAM is a **global** AWS service: all requests go to the single global endpoint `https://iam.amazonaws.com/` and are **always SigV4-signed for the `us-east-1` region**, regardless of the configured Region. The **Region** setting is only used when authenticating via an IAM Role, since STS `AssumeRole` is a regional call.

Configure one of two authentication methods:

- **API Key** — provide an **Access Key** and **Secret Key** with the required IAM permissions.
- **IAM Role** — provide an Access Key/Secret Key plus an **IAM Role ARN** (and optional **External ID**); the service calls STS `AssumeRole` in the configured region and uses the temporary credentials.

| Config item | Required | Notes |
| --- | --- | --- |
| Authentication Method | Yes | `API Key` or `IAM Role`. |
| Region | Yes | AWS region code. IAM is signed for `us-east-1`; only used for STS `AssumeRole`. |
| Access Key | No\* | AWS access key ID (required for both methods). |
| Secret Key | No\* | AWS secret access key (required for both methods). |
| IAM Role ARN | No\* | Role ARN to assume (required for the IAM Role method). |
| External ID | No | Optional external ID for cross-account role assumption. |

Dynamic dropdowns for users, roles, and customer-managed policies are backed by internal dictionaries.

## Notes

- **The access key secret is shown only once.** `Create Access Key` returns the secret access key a single time — it cannot be retrieved again, so store it securely immediately.
- **Destructive operations are irreversible.** `Delete User`, `Delete Group`, `Delete Role`, `Delete Policy`, and `Delete Access Key` permanently remove IAM entities and cannot be undone.
- **Deletion dependencies.** IAM blocks deleting an entity that still has dependents (attached policies, group memberships, access keys, non-default policy versions, instance-profile associations). Remove those first or the request fails with a deletion conflict.
- **AWS-managed policies** cannot be created or deleted; only customer-managed (Local) policies can.

## Agent Ideas

- After **AWS IAM** "Create User" and "Create Access Key" during onboarding, use **Amazon SES** "Send Email" to securely deliver the new credentials and setup instructions to the user.
- When rotating credentials, use **AWS IAM** "Update Access Key" to deactivate an old key and then **Amazon SNS** "Publish Message" to notify a security topic that the rotation completed.
- Run **AWS IAM** "Get Account Summary" and "List Users" on a schedule, then use **Amazon SQS** "Send Message" to enqueue the audit snapshot for a downstream compliance-processing workflow.
