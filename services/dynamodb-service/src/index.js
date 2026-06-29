'use strict'

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')
const {
  marshall,
  marshallItem,
  unmarshallItem,
  marshallValues,
  buildUpdateExpression,
  encodeCursor,
  decodeCursor,
  chunk,
} = require('./marshall')

const TARGET_PREFIX = 'DynamoDB_20120810'
const CONTENT_TYPE = 'application/x-amz-json-1.0'
const MAX_BATCH_RETRIES = 5

/**
 * @integrationName DynamoDB
 * @integrationIcon /icon.png
 */
class DynamoDB {
  constructor(config = {}, context = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('DynamoDB')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { jsonRequest }
    this._sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  }

  async sendJson(operation, body) {
    const creds = await this.credentials.resolve()

    return this.deps.jsonRequest(
      { region: this.region, service: 'dynamodb', target: `${ TARGET_PREFIX }.${ operation }`, contentType: CONTENT_TYPE, body },
      creds
    )
  }

  /**
   * @operationName Put Item
   * @description Creates a new item or replaces an existing item with the same primary key in a DynamoDB table. The item is supplied as plain JSON and is automatically converted to DynamoDB's attribute format.
   * @route POST /put-item
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table to write to."}
   * @paramDef {"type":"Object","label":"Item","name":"item","required":true,"description":"The item to store, as plain JSON. Must include the table's primary key attribute(s)."}
   * @paramDef {"type":"String","label":"Condition Expression","name":"conditionExpression","required":false,"description":"Optional condition that must be satisfied for the write to succeed, e.g. attribute_not_exists(id)."}
   * @paramDef {"type":"Object","label":"Expression Attribute Values","name":"expressionAttributeValues","required":false,"description":"Optional values referenced by the condition expression, as plain JSON keyed by placeholder (e.g. {\":min\":10})."}
   * @paramDef {"type":"String","label":"Return Values","name":"returnValues","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["NONE","ALL_OLD"]}},"description":"Set to ALL_OLD to return the previous version of the item."}
   * @returns {Object}
   * @sampleResult {"item":{"id":"1","age":30},"oldItem":null}
   */
  async putItem(tableName, item, conditionExpression, expressionAttributeValues, returnValues) {
    if (!tableName) throw new Error('tableName is required.')
    if (!item || typeof item !== 'object') throw new Error('item (plain JSON object) is required.')

    try {
      const body = { TableName: tableName, Item: marshallItem(item) }

      if (conditionExpression) body.ConditionExpression = conditionExpression
      if (expressionAttributeValues) body.ExpressionAttributeValues = marshallValues(expressionAttributeValues)
      if (returnValues) body.ReturnValues = returnValues

      const res = await this.sendJson('PutItem', body)

      return { item, oldItem: res.Attributes ? unmarshallItem(res.Attributes) : null }
    } catch (error) {
      this.#handleError('putItem', error)
    }
  }

  /**
   * @operationName Get Item
   * @description Retrieves a single item from a DynamoDB table by its primary key. The key is supplied as plain JSON and the returned item is plain JSON.
   * @route POST /get-item
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table to read from."}
   * @paramDef {"type":"Object","label":"Key","name":"key","required":true,"description":"The primary key of the item, as plain JSON (e.g. {\"id\":\"123\"} or {\"pk\":\"a\",\"sk\":\"b\"})."}
   * @paramDef {"type":"Boolean","label":"Consistent Read","name":"consistentRead","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Use a strongly consistent read instead of the default eventually consistent read."}
   * @paramDef {"type":"String","label":"Projection Expression","name":"projectionExpression","required":false,"description":"Optional comma-separated list of attributes to return (e.g. id, name, email)."}
   * @returns {Object}
   * @sampleResult {"item":{"id":"123","name":"Ada","email":"ada@example.com"}}
   */
  async getItem(tableName, key, consistentRead, projectionExpression) {
    if (!tableName) throw new Error('tableName is required.')
    if (!key || typeof key !== 'object') throw new Error('key (plain JSON object) is required.')

    try {
      const body = { TableName: tableName, Key: marshallItem(key) }

      if (consistentRead) body.ConsistentRead = true
      if (projectionExpression) body.ProjectionExpression = projectionExpression

      const res = await this.sendJson('GetItem', body)

      return { item: res.Item ? unmarshallItem(res.Item) : null }
    } catch (error) {
      this.#handleError('getItem', error)
    }
  }

  /**
   * @operationName Update Item
   * @description Updates attributes of an existing item, or creates it if it does not exist. Provide a simple "updates" object to set attributes, or supply a raw updateExpression for advanced operations (ADD, REMOVE, conditional math).
   * @route POST /update-item
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table containing the item."}
   * @paramDef {"type":"Object","label":"Key","name":"key","required":true,"description":"The primary key of the item to update, as plain JSON."}
   * @paramDef {"type":"Object","label":"Updates","name":"updates","required":false,"description":"Plain JSON of attributes to set (e.g. {\"status\":\"active\",\"age\":31}). Ignored when Update Expression is provided."}
   * @paramDef {"type":"String","label":"Update Expression","name":"updateExpression","required":false,"description":"Advanced: a raw DynamoDB update expression (e.g. ADD visits :one). Overrides Updates."}
   * @paramDef {"type":"Object","label":"Expression Attribute Values","name":"expressionAttributeValues","required":false,"description":"Values for the raw update/condition expression, plain JSON keyed by placeholder (e.g. {\":one\":1})."}
   * @paramDef {"type":"Object","label":"Expression Attribute Names","name":"expressionAttributeNames","required":false,"description":"Name aliases for the raw update/condition expression (e.g. {\"#v\":\"visits\"})."}
   * @paramDef {"type":"String","label":"Condition Expression","name":"conditionExpression","required":false,"description":"Optional condition that must be satisfied for the update to proceed."}
   * @paramDef {"type":"String","label":"Return Values","name":"returnValues","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["ALL_NEW","ALL_OLD","UPDATED_NEW","UPDATED_OLD","NONE"]}},"description":"Which version of the attributes to return. Defaults to ALL_NEW."}
   * @returns {Object}
   * @sampleResult {"attributes":{"id":"1","status":"active","age":31}}
   */
  async updateItem(tableName, key, updates, updateExpression, expressionAttributeValues, expressionAttributeNames, conditionExpression, returnValues) {
    if (!tableName) throw new Error('tableName is required.')
    if (!key || typeof key !== 'object') throw new Error('key (plain JSON object) is required.')

    try {
      const body = { TableName: tableName, Key: marshallItem(key), ReturnValues: returnValues || 'ALL_NEW' }

      if (updateExpression) {
        body.UpdateExpression = updateExpression

        if (expressionAttributeValues) body.ExpressionAttributeValues = marshallValues(expressionAttributeValues)
        if (expressionAttributeNames) body.ExpressionAttributeNames = expressionAttributeNames
      } else {
        const built = buildUpdateExpression(updates)

        body.UpdateExpression = built.UpdateExpression
        body.ExpressionAttributeNames = built.ExpressionAttributeNames
        body.ExpressionAttributeValues = built.ExpressionAttributeValues
      }

      if (conditionExpression) body.ConditionExpression = conditionExpression

      const res = await this.sendJson('UpdateItem', body)

      return { attributes: res.Attributes ? unmarshallItem(res.Attributes) : null }
    } catch (error) {
      this.#handleError('updateItem', error)
    }
  }

  /**
   * @operationName Delete Item
   * @description Deletes a single item from a DynamoDB table by its primary key. Optionally returns the deleted item.
   * @route POST /delete-item
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table containing the item."}
   * @paramDef {"type":"Object","label":"Key","name":"key","required":true,"description":"The primary key of the item to delete, as plain JSON."}
   * @paramDef {"type":"String","label":"Condition Expression","name":"conditionExpression","required":false,"description":"Optional condition that must be satisfied for the delete to proceed."}
   * @paramDef {"type":"String","label":"Return Values","name":"returnValues","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["NONE","ALL_OLD"]}},"description":"Set to ALL_OLD to return the item as it was before deletion."}
   * @returns {Object}
   * @sampleResult {"deleted":{"id":"1","name":"Ada"}}
   */
  async deleteItem(tableName, key, conditionExpression, returnValues) {
    if (!tableName) throw new Error('tableName is required.')
    if (!key || typeof key !== 'object') throw new Error('key (plain JSON object) is required.')

    try {
      const body = { TableName: tableName, Key: marshallItem(key) }

      if (conditionExpression) body.ConditionExpression = conditionExpression
      if (returnValues) body.ReturnValues = returnValues

      const res = await this.sendJson('DeleteItem', body)

      return { deleted: res.Attributes ? unmarshallItem(res.Attributes) : null }
    } catch (error) {
      this.#handleError('deleteItem', error)
    }
  }

  /**
   * @operationName Query
   * @description Queries a table or secondary index using a key condition expression, returning matching items as plain JSON. Supports filtering, pagination via cursor, and sort-order control.
   * @route POST /query
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table to query."}
   * @paramDef {"type":"String","label":"Key Condition Expression","name":"keyConditionExpression","required":true,"description":"The key condition, e.g. pk = :p AND sk BETWEEN :a AND :b."}
   * @paramDef {"type":"Object","label":"Expression Attribute Values","name":"expressionAttributeValues","required":true,"description":"Values for the placeholders, plain JSON keyed by placeholder (e.g. {\":p\":\"tenant1\"})."}
   * @paramDef {"type":"Object","label":"Expression Attribute Names","name":"expressionAttributeNames","required":false,"description":"Optional name aliases for reserved words (e.g. {\"#n\":\"name\"})."}
   * @paramDef {"type":"String","label":"Filter Expression","name":"filterExpression","required":false,"description":"Optional filter applied after the key condition (e.g. #status = :active)."}
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":false,"description":"Optional global or local secondary index name to query."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Maximum number of items to evaluate (not necessarily returned)."}
   * @paramDef {"type":"Boolean","label":"Ascending","name":"scanIndexForward","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Sort order by sort key. True (default) is ascending; false is descending."}
   * @paramDef {"type":"String","label":"Projection Expression","name":"projectionExpression","required":false,"description":"Optional comma-separated list of attributes to return."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"pk":"tenant1","sk":"order#1","total":42}],"count":1,"cursor":null}
   */
  async query(tableName, keyConditionExpression, expressionAttributeValues, expressionAttributeNames, filterExpression, indexName, limit, scanIndexForward, projectionExpression, cursor) {
    if (!tableName) throw new Error('tableName is required.')
    if (!keyConditionExpression) throw new Error('keyConditionExpression is required.')

    try {
      const body = { TableName: tableName, KeyConditionExpression: keyConditionExpression }

      if (expressionAttributeValues) body.ExpressionAttributeValues = marshallValues(expressionAttributeValues)
      if (expressionAttributeNames) body.ExpressionAttributeNames = expressionAttributeNames
      if (filterExpression) body.FilterExpression = filterExpression
      if (indexName) body.IndexName = indexName
      if (projectionExpression) body.ProjectionExpression = projectionExpression
      if (limit) body.Limit = limit
      if (scanIndexForward === false) body.ScanIndexForward = false
      if (cursor) body.ExclusiveStartKey = decodeCursor(cursor)

      const res = await this.sendJson('Query', body)

      return {
        items: (res.Items || []).map(unmarshallItem),
        count: res.Count || 0,
        cursor: res.LastEvaluatedKey ? encodeCursor(res.LastEvaluatedKey) : null,
      }
    } catch (error) {
      this.#handleError('query', error)
    }
  }

  /**
   * @operationName Scan
   * @description Scans an entire table or index, optionally applying a filter, and returns matching items as plain JSON. Use Query instead when you can filter by partition key. Supports pagination via cursor.
   * @route POST /scan
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table to scan."}
   * @paramDef {"type":"String","label":"Filter Expression","name":"filterExpression","required":false,"description":"Optional filter applied to each item (e.g. #status = :active)."}
   * @paramDef {"type":"Object","label":"Expression Attribute Values","name":"expressionAttributeValues","required":false,"description":"Values for the filter placeholders, plain JSON keyed by placeholder."}
   * @paramDef {"type":"Object","label":"Expression Attribute Names","name":"expressionAttributeNames","required":false,"description":"Optional name aliases for reserved words."}
   * @paramDef {"type":"String","label":"Index Name","name":"indexName","required":false,"description":"Optional secondary index name to scan."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Maximum number of items to evaluate (not necessarily returned)."}
   * @paramDef {"type":"String","label":"Projection Expression","name":"projectionExpression","required":false,"description":"Optional comma-separated list of attributes to return."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"1","active":true}],"count":1,"cursor":null}
   */
  async scan(tableName, filterExpression, expressionAttributeValues, expressionAttributeNames, indexName, limit, projectionExpression, cursor) {
    if (!tableName) throw new Error('tableName is required.')

    try {
      const body = { TableName: tableName }

      if (filterExpression) body.FilterExpression = filterExpression
      if (expressionAttributeValues) body.ExpressionAttributeValues = marshallValues(expressionAttributeValues)
      if (expressionAttributeNames) body.ExpressionAttributeNames = expressionAttributeNames
      if (indexName) body.IndexName = indexName
      if (projectionExpression) body.ProjectionExpression = projectionExpression
      if (limit) body.Limit = limit
      if (cursor) body.ExclusiveStartKey = decodeCursor(cursor)

      const res = await this.sendJson('Scan', body)

      return {
        items: (res.Items || []).map(unmarshallItem),
        count: res.Count || 0,
        cursor: res.LastEvaluatedKey ? encodeCursor(res.LastEvaluatedKey) : null,
      }
    } catch (error) {
      this.#handleError('scan', error)
    }
  }

  /**
   * @operationName Batch Get Items
   * @description Retrieves up to many items from a single table by primary key, automatically splitting into batches of 100 and retrying any unprocessed keys. Returns items as plain JSON.
   * @route POST /batch-get-item
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table to read from."}
   * @paramDef {"type":"Array","label":"Keys","name":"keys","required":true,"description":"An array of primary keys, each as plain JSON (e.g. [{\"id\":\"1\"},{\"id\":\"2\"}])."}
   * @paramDef {"type":"Boolean","label":"Consistent Read","name":"consistentRead","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Use strongly consistent reads."}
   * @paramDef {"type":"String","label":"Projection Expression","name":"projectionExpression","required":false,"description":"Optional comma-separated list of attributes to return."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"1","name":"Ada"},{"id":"2","name":"Linus"}]}
   */
  async batchGetItem(tableName, keys, consistentRead, projectionExpression) {
    if (!tableName) throw new Error('tableName is required.')
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('keys must be a non-empty array.')

    try {
      const all = []

      for (const part of chunk(keys, 100)) {
        let pending = part.map(marshallItem)
        let attempt = 0

        while (pending.length) {
          const requestItem = { Keys: pending }

          if (consistentRead) requestItem.ConsistentRead = true
          if (projectionExpression) requestItem.ProjectionExpression = projectionExpression

          const res = await this.sendJson('BatchGetItem', { RequestItems: { [tableName]: requestItem } })
          const got = (res.Responses && res.Responses[tableName]) || []

          all.push(...got.map(unmarshallItem))

          pending = (res.UnprocessedKeys && res.UnprocessedKeys[tableName] && res.UnprocessedKeys[tableName].Keys) || []

          if (pending.length) {
            attempt++
            if (attempt > MAX_BATCH_RETRIES) break
            await this._sleep(Math.min(100 * 2 ** attempt, 2000))
          }
        }
      }

      return { items: all }
    } catch (error) {
      this.#handleError('batchGetItem', error)
    }
  }

  /**
   * @operationName Batch Write Items
   * @description Puts and/or deletes many items in a single table, automatically splitting into batches of 25 and retrying unprocessed items. Items and keys are plain JSON.
   * @route POST /batch-write-item
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table to write to."}
   * @paramDef {"type":"Array","label":"Put Items","name":"putItems","required":false,"description":"Array of items to put, each as plain JSON. Each must include the primary key."}
   * @paramDef {"type":"Array","label":"Delete Keys","name":"deleteKeys","required":false,"description":"Array of primary keys to delete, each as plain JSON."}
   * @returns {Object}
   * @sampleResult {"processed":2,"unprocessed":[{"put":{"id":"3","name":"Cleo"}}]}
   */
  async batchWriteItem(tableName, putItems, deleteKeys) {
    if (!tableName) throw new Error('tableName is required.')

    const puts = Array.isArray(putItems) ? putItems : []
    const deletes = Array.isArray(deleteKeys) ? deleteKeys : []

    if (puts.length === 0 && deletes.length === 0) {
      throw new Error('Provide at least one item in putItems or deleteKeys.')
    }

    try {
      const requests = [
        ...puts.map(item => ({ PutRequest: { Item: marshallItem(item) } })),
        ...deletes.map(key => ({ DeleteRequest: { Key: marshallItem(key) } })),
      ]

      let processed = 0
      const leftovers = []

      for (const part of chunk(requests, 25)) {
        let pending = part
        let attempt = 0

        while (pending.length) {
          const res = await this.sendJson('BatchWriteItem', { RequestItems: { [tableName]: pending } })
          const unprocessed = (res.UnprocessedItems && res.UnprocessedItems[tableName]) || []

          processed += pending.length - unprocessed.length
          pending = unprocessed

          if (pending.length) {
            attempt++

            if (attempt > MAX_BATCH_RETRIES) {
              leftovers.push(...pending)
              break
            }

            await this._sleep(Math.min(100 * 2 ** attempt, 2000))
          }
        }
      }

      const unprocessed = leftovers.map(r =>
        r.PutRequest
          ? { put: unmarshallItem(r.PutRequest.Item) }
          : { delete: unmarshallItem(r.DeleteRequest.Key) }
      )

      return { processed, unprocessed }
    } catch (error) {
      this.#handleError('batchWriteItem', error)
    }
  }

  /**
   * @operationName Execute Statement (PartiQL)
   * @description Runs a PartiQL (SQL-compatible) statement against DynamoDB and returns results as plain JSON. Use ? placeholders with the parameters array. Supports pagination via cursor.
   * @route POST /execute-statement
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Statement","name":"statement","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The PartiQL statement, e.g. SELECT * FROM \"Users\" WHERE id = ?."}
   * @paramDef {"type":"Array","label":"Parameters","name":"parameters","required":false,"description":"Values for ? placeholders, as a plain JSON array (e.g. [\"123\", 30])."}
   * @paramDef {"type":"Boolean","label":"Consistent Read","name":"consistentRead","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Use a strongly consistent read."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"123","name":"Ada"}],"cursor":null}
   */
  async executeStatement(statement, parameters, consistentRead, cursor) {
    if (!statement) throw new Error('statement is required.')

    try {
      const body = { Statement: statement }

      if (Array.isArray(parameters) && parameters.length) body.Parameters = parameters.map(marshall)
      if (consistentRead) body.ConsistentRead = true
      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ExecuteStatement', body)

      return {
        items: (res.Items || []).map(unmarshallItem),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('executeStatement', error)
    }
  }

  /**
   * @operationName Describe Table
   * @description Returns metadata about a DynamoDB table: its key schema, attribute definitions, secondary indexes, item count, size, and status. Useful for discovering a table's primary key before reading or writing.
   * @route POST /describe-table
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTablesDictionary","description":"The name of the table to describe."}
   * @returns {Object}
   * @sampleResult {"tableName":"Users","status":"ACTIVE","itemCount":42,"sizeBytes":1024,"keySchema":[{"AttributeName":"id","KeyType":"HASH"}],"attributeDefinitions":[{"AttributeName":"id","AttributeType":"S"}],"indexes":{"global":[],"local":[]}}
   */
  async describeTable(tableName) {
    if (!tableName) throw new Error('tableName is required.')

    try {
      const res = await this.sendJson('DescribeTable', { TableName: tableName })
      const t = res.Table || {}

      return {
        tableName: t.TableName,
        status: t.TableStatus,
        itemCount: t.ItemCount,
        sizeBytes: t.TableSizeBytes,
        keySchema: t.KeySchema || [],
        attributeDefinitions: t.AttributeDefinitions || [],
        indexes: { global: t.GlobalSecondaryIndexes || [], local: t.LocalSecondaryIndexes || [] },
      }
    } catch (error) {
      this.#handleError('describeTable', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName List Tables Dictionary
   * @description Provides a searchable list of DynamoDB table names for dynamic dropdown selection in other operations.
   * @route POST /list-tables-dictionary
   * @paramDef {"type":"listTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Users","value":"Users"}],"cursor":null}
   */
  async listTablesDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const body = { Limit: 100 }

      if (cursor) body.ExclusiveStartTableName = decodeCursor(cursor)

      const res = await this.sendJson('ListTables', body)
      let names = res.TableNames || []

      if (search) {
        const lower = search.toLowerCase()

        names = names.filter(name => name.toLowerCase().includes(lower))
      }

      return {
        items: names.map(name => ({ label: name, value: name })),
        cursor: res.LastEvaluatedTableName ? encodeCursor(res.LastEvaluatedTableName) : null,
      }
    } catch (error) {
      this.#handleError('listTablesDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'ResourceNotFoundException') {
      throw new Error(`Resource not found: ${ error.message }. Check the table name.`)
    }

    if (error && error.name === 'ConditionalCheckFailedException') {
      throw new Error('Condition not met: the item did not satisfy the supplied conditionExpression.')
    }

    if (error && error.name === 'ValidationException') {
      throw new Error(`Invalid request: ${ error.message }. Check keys, expressions, and attribute values.`)
    }

    if (error && error.name === 'TransactionConflictException') {
      throw new Error(`Transaction conflict: ${ error.message }. Another write is in progress; retry.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(DynamoDB, awsConfigItems)
}

module.exports = { DynamoDB }
