# AWS Elastic Load Balancing FlowRunner Extension

Manage and monitor Amazon Elastic Load Balancing (ELBv2) — Application Load Balancers (ALB), Network Load Balancers (NLB), and Gateway Load Balancers (GLB). The service is read-heavy and centered on inspection and target-health monitoring, with supporting create/modify/delete operations for load balancers, target groups, listeners, rules, and tags. It authenticates to AWS using hand-rolled Signature Version 4 with zero external dependencies.

## Ideal Use Cases

- Monitor target-group health and branch a flow when any target reports `unhealthy`, or wait for `initial` targets to become `healthy` after registration.
- Automate blue/green or scaling workflows by registering and deregistering targets (EC2 instances, IPs, Lambda functions, or nested ALBs) with a target group.
- Provision load balancers, target groups, and listeners as part of an infrastructure automation flow.
- Audit ELB inventory across a region, inspecting listeners, rules, and tags for compliance reporting.

## List of Actions

### Load Balancers
- Describe Load Balancers
- Create Load Balancer
- Delete Load Balancer

### Target Groups
- Describe Target Groups
- Create Target Group
- Modify Target Group
- Delete Target Group

### Target Health
- Describe Target Health
- Register Targets
- Deregister Targets

### Listeners
- Describe Listeners
- Create Listener
- Modify Listener
- Delete Listener

### Rules
- Describe Rules

### Tags
- Describe Tags
- Add Tags
- Remove Tags

## List of Triggers

This service does not define any triggers.

## Authentication

Signature Version 4 is hand-rolled with zero external dependencies. Two authentication methods are supported through the shared AWS configuration items:

- **API Key** — supply an access key and secret key directly.
- **IAM Role** — supply an access key/secret key plus a Role ARN (and optional external ID); the service assumes the role via STS `AssumeRole` for cross-account access.

### Configuration

| Item | Required | Notes |
| --- | --- | --- |
| Authentication Method | Yes | `API Key` or `IAM Role`. |
| Region | Yes | AWS region code, e.g. `us-east-1`. The ELB endpoint is `elasticloadbalancing.{region}.amazonaws.com`. |
| Access Key | Conditional | Access key ID (required for both methods). |
| Secret Key | Conditional | Secret access key (required for both methods). |
| IAM Role ARN | Conditional | Required for IAM Role authentication. |
| External ID | No | Optional external ID for cross-account role assumption. |

## Protocol: AWS Query / XML

Unlike JSON-protocol AWS services, ELBv2 uses the **AWS Query** protocol (API version `2015-12-01`):

- Requests are `POST /` with a form-encoded body: `Action={Op}&Version=2015-12-01&...`.
- List parameters are flattened as `Name.member.1`, `Name.member.2`, … and object members as `Name.member.1.Field` (e.g. `Targets.member.1.Id`, `Targets.member.1.Port`).
- Responses are **XML**. A small, zero-dependency parser converts the `<member>`-based structures into plain, camelCased JS objects and arrays.

Errors are surfaced from the ELB XML `<Error>` element, extracting the `Code` and `Message` and mapping common cases (not-found, duplicate name, validation, resource-in-use, throttling, credentials) to clear messages.

## Resource ARNs

Most operations key off Amazon Resource Names (ARNs):

- Load balancer ARN — `arn:aws:elasticloadbalancing:{region}:{account}:loadbalancer/app|net|gwy/{name}/{id}`
- Target group ARN — `arn:aws:elasticloadbalancing:{region}:{account}:targetgroup/{name}/{id}`
- Listener / rule ARNs — derived from the load balancer ARN.

Two dictionaries make selection easier in flows: load balancers and target groups are available as searchable dropdowns (label = resource name, value = ARN).

## Target Health Monitoring

`Describe Target Health` is the most common operational use in flows: poll a target group's ARN and act on the returned per-target state — `healthy`, `unhealthy`, `initial`, `draining`, `unused`, or `unavailable` — along with the reason and description. A typical pattern is to branch when any target reports `unhealthy`, or to wait for `initial` targets to become `healthy` after **Register Targets**.

## Notes

- Zero runtime dependencies; SigV4, the Query encoder, and the XML parser are all implemented in-repo under `src/`.
- The service targets the region configured in the service settings; create a separate configuration per region as needed.

## Agent Ideas

- After **Register Targets** in a target group, poll **Describe Target Health** and, once a target reports `unhealthy`, use **Amazon SNS** "Publish Message" to alert the on-call team with the target ID and failure reason.
- Use **AWS Lambda** "Invoke Function" to run a custom deployment step, then call **Register Targets** to add the new instances/IPs to a target group and **Deregister Targets** to drain the old ones for a blue/green cutover.
- On a schedule, run **Describe Load Balancers** and **Describe Target Health** across the region and use **S3 Storage** "Upload Object" to archive the health snapshot as a compliance/audit record.
