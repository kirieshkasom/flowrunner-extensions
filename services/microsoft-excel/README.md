# Microsoft Excel 365 FlowRunner Extension

FlowRunner integration for [Microsoft Excel 365](https://www.microsoft.com/en-us/microsoft-365/excel) built
on the [Microsoft Graph workbook API](https://learn.microsoft.com/en-us/graph/api/resources/excel) (v1.0). It
lets flows read and write worksheet ranges, manage worksheets, and work with Excel tables (rows and columns)
in workbooks stored in the connected user's OneDrive. Range and table reads can return rows as convenient
objects keyed by headers, and writes accept either 2D arrays or arrays of objects.

Workbooks are selected from OneDrive — this service does not create new workbook files. Create the .xlsx file
in OneDrive or Excel first, then pick it in the Workbook parameter.

## Ideal Use Cases

- Append form submissions, leads, or orders as rows to an Excel table
- Read a spreadsheet range as objects and feed each row into downstream workflow steps
- Keep a shared report sheet updated by writing computed values into ranges
- Sync records between Excel tables and CRMs, databases, or other services
- Clear and rebuild a data region on a schedule (e.g. nightly refresh)
- Provision worksheets and tables on demand for per-project or per-period data

## List of Actions

### Workbooks

- List Workbooks

### Worksheets

- List Worksheets
- Add Worksheet
- Delete Worksheet

### Ranges

- Get Range Values
- Update Range Values
- Get Used Range
- Clear Range

### Tables

- List Tables
- Create Table
- Add Table Rows
- List Table Rows
- List Table Columns
- Delete Table Row

Dynamic dropdowns are provided for workbooks (OneDrive search), worksheets, and tables (both dependent on the
selected workbook).

## Authentication

OAuth2 via Microsoft Entra with delegated permissions: `offline_access`, `User.Read`,
`Files.ReadWrite.All`. Configure the app registration's Client ID and Client Secret in the service settings.

## Agent Ideas

- When a new **Outlook** "Get Messages List" item is retrieved, use **Microsoft Excel 365** "Add Table Rows" to log each email's sender, subject, and received date into a tracking table.
- Read a data region with **Microsoft Excel 365** "Get Range Values" as objects, then use **Outlook** "Send Message" to email a formatted summary of the rows to stakeholders.
- Use **Microsoft OneDrive** "Search Items" to locate a workbook, then call **Microsoft Excel 365** "List Table Rows" to extract its contents for downstream processing.
