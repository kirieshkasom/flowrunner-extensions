# DynamoDB FlowRunner Extension

| **Kind** | **Name** | **Description** |
|----------------|----------------|---------------------|
| ACTION | Put Item | Creates a new item or replaces an existing item with the same primary key in a DynamoDB table. The item is supplied as plain JSON and is automatically converted to DynamoDB&#x27;s attribute format. |
| ACTION | Get Item | Retrieves a single item from a DynamoDB table by its primary key. The key is supplied as plain JSON and the returned item is plain JSON. |
| ACTION | Update Item | Updates attributes of an existing item, or creates it if it does not exist. Provide a simple &quot;updates&quot; object to set attributes, or supply a raw updateExpression for advanced operations (ADD, REMOVE, conditional math). |
| ACTION | Delete Item | Deletes a single item from a DynamoDB table by its primary key. Optionally returns the deleted item. |
| ACTION | Query | Queries a table or secondary index using a key condition expression, returning matching items as plain JSON. Supports filtering, pagination via cursor, and sort-order control. |
| ACTION | Scan | Scans an entire table or index, optionally applying a filter, and returns matching items as plain JSON. Use Query instead when you can filter by partition key. Supports pagination via cursor. |
| ACTION | Batch Get Items | Retrieves up to many items from a single table by primary key, automatically splitting into batches of 100 and retrying any unprocessed keys. Returns items as plain JSON. |
| ACTION | Batch Write Items | Puts and/or deletes many items in a single table, automatically splitting into batches of 25 and retrying unprocessed items. Items and keys are plain JSON. |
| ACTION | Execute Statement (PartiQL) | Runs a PartiQL (SQL-compatible) statement against DynamoDB and returns results as plain JSON. Use ? placeholders with the parameters array. Supports pagination via cursor. |
| ACTION | Describe Table | Returns metadata about a DynamoDB table: its key schema, attribute definitions, secondary indexes, item count, size, and status. Useful for discovering a table&#x27;s primary key before reading or writing. |
