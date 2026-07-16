# AWS Certificate Manager FlowRunner Extension

Provision, manage, and deploy public and private SSL/TLS certificates with [AWS Certificate Manager (ACM)](https://docs.aws.amazon.com/acm/). The service talks to the ACM API directly using the AWS JSON 1.1 protocol with hand-rolled Signature Version 4 request signing (zero npm dependencies).

## Ideal Use Cases

- Automate certificate provisioning for a new domain and retrieve the DNS CNAME records needed to validate it.
- Audit and inventory certificates across a region, filtering by status (issued, pending, expired).
- Export an issued certificate's PEM body and chain for installation on non-AWS servers.
- Tag certificates for cost allocation and access control, then clean up unused certificates.
- Trigger managed renewal of eligible AWS Private CA certificates.

## List of Actions

- Add Tags To Certificate
- Delete Certificate
- Describe Certificate
- Get Certificate
- List Certificates
- List Tags For Certificate
- Remove Tags From Certificate
- Renew Certificate
- Request Certificate
- Resend Validation Email

A **Get Certificates Dictionary** helper powers searchable ARN dropdowns (labeled by domain name).

## List of Triggers

This service does not define any triggers.

## Configuration

ACM is a regional service; the endpoint is `acm.{region}.amazonaws.com`, and certificate ARNs are region-specific, so ensure the configured **Region** matches where your certificates live. Certificates used with Amazon CloudFront must be requested in **us-east-1**.

- **Authentication Method** — `API Key` (use the access key directly) or `IAM Role` (STS AssumeRole for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`, `eu-west-1`.
- **Access Key** — AWS access key ID (required for both methods).
- **Secret Key** — AWS secret access key (required for both methods).
- **IAM Role ARN** — ARN of the role to assume (required for IAM Role auth), e.g. `arn:aws:iam::123456789012:role/MyRole`.
- **External ID** — optional external ID for cross-account role assumption.

Certificate ARNs look like `arn:aws:acm:us-east-1:123456789012:certificate/12345678-...`. Use **List Certificates** or the certificate-selector dropdown to discover them.

## Request → Validate flow

Requesting a **public** certificate does not issue it immediately — you must prove domain ownership using one of two validation methods.

**DNS validation (recommended):**

1. Call **Request Certificate** with `Validation Method = DNS`.
2. The certificate starts in `PENDING_VALIDATION`. Wait a few seconds, then call **Describe Certificate**.
3. Read `DomainValidationOptions[].ResourceRecord` — each entry gives a CNAME record (`Name`, `Type`, `Value`) to add to your DNS zone.
4. Create those CNAME records at your DNS provider. ACM checks periodically and, once the records resolve, moves the certificate to `ISSUED`. DNS-validated certificates also renew automatically as long as the records remain in place.

**Email validation:**

1. Call **Request Certificate** with `Validation Method = Email`.
2. ACM emails the domain's WHOIS contacts plus `admin@`, `administrator@`, `hostmaster@`, `postmaster@`, and `webmaster@` of the domain.
3. An approver clicks the link in the email to issue the certificate.
4. If the emails are lost, call **Resend Validation Email** with the `Domain` and `Validation Domain`.

Once the certificate reaches `ISSUED`, use **Get Certificate** to retrieve the PEM body and chain.

## Notes

- Public certificates are renewed automatically by ACM (managed renewal). **Renew Certificate** applies only to eligible private certificates issued by AWS Private CA (`RenewalEligibility` is `ELIGIBLE`).
- A certificate cannot be deleted while attached to an AWS resource (load balancer, CloudFront distribution); detach it first.
- Errors are surfaced from ACM's `__type` / `message` fields (e.g. `ResourceNotFoundException`, `InvalidArnException`, `RequestInProgressException`).

## Agent Ideas

- Use **AWS Certificate Manager** "Request Certificate" (DNS) then "Describe Certificate" to obtain the CNAME record, and once issued call **AWS Elastic Load Balancing** "Create Listener" to attach the certificate ARN to an HTTPS listener on a load balancer.
- After **AWS Certificate Manager** "Request Certificate" returns a pending certificate, use **Amazon SNS** "Publish Message" to notify the DNS/ops team of the CNAME records they need to add to complete validation.
- On a schedule, call **AWS Certificate Manager** "List Certificates" to find certificates nearing expiry, then use **Amazon SES** "Send Email" to alert owners of certificates that require attention.
