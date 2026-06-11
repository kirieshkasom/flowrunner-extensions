# Acumatica FlowRunner Extension

Integrates with Acumatica ERP for vendor management, accounts payable bill processing, reference data lookups, and AP reporting. Authenticates via cookie-based sessions using Instance URL, Username, and Password. Supports full bill lifecycle operations including creation, hold release, file attachment, and deletion.

## Ideal Use Cases

- Automating accounts payable bill creation from parsed invoices
- Validating and creating vendor records in onboarding workflows
- Detecting duplicate bills by vendor reference before entry
- Releasing approved bills from hold for payment processing
- Attaching source documents to Acumatica bill records
- Searching and auditing bills by description or reference number
- Looking up GL accounts and payment terms for validation
- Generating AP aging reports filtered by vendor

## List of Actions

### Vendors

- Create Vendor
- Get Vendor
- List Vendors
- Validate Vendor

### Bills

- Attach File to Bill
- Check Duplicate Bill
- Create Bill
- Delete Bill
- Download Bill File
- Get Bill
- Get Bill by Reference Number
- List Bill Files
- List Bills
- Release Bill from Hold
- Search Bills by Description

### Reference Data

- List Credit Terms
- List GL Accounts

### Reports

- Get AP Account Balance

## Agent Ideas

- When Parseur's "On Document Processed" trigger fires with parsed invoice data, use Acumatica's "Validate Vendor" to confirm the vendor exists, then call "Check Duplicate Bill" and "Create Bill" to enter the invoice into accounts payable, and finally use "Attach File to Bill" to link the original PDF to the Acumatica record
- After using Acumatica's "Create Bill" and "Release Bill from Hold" to process a new invoice, use Gmail's "Send Message" to notify the finance team with the bill reference number, amount, and vendor details
- Use Acumatica's "Get AP Account Balance" to pull vendor aging data, then call Google Sheets' "Add Row" for each vendor to build an AP aging summary spreadsheet for monthly financial review
