'use strict'

const { restJsonRequest, restRequest, parseJsonResponse } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

/**
 * @integrationName AWS Lambda
 * @integrationIcon /icon.jpeg
 */
class Lambda {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('Lambda')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { restJsonRequest, restRequest }
  }

  async sendRest(method, path, body) {
    const creds = await this.credentials.resolve()

    return this.deps.restJsonRequest({ region: this.region, service: 'lambda', method, path, body }, creds)
  }

  async invokeRaw(path, payload, invocationType) {
    const creds = await this.credentials.resolve()

    return this.deps.restRequest(
      {
        region: this.region,
        service: 'lambda',
        method: 'POST',
        path,
        body: payload,
        headers: { 'x-amz-invocation-type': invocationType },
      },
      creds
    )
  }

  /**
   * @operationName Invoke Function
   * @description Invokes a function synchronously (RequestResponse), asynchronously (Event), or performs a dry run (DryRun) without executing. Returns the status code, any function error, and the parsed response payload.
   * @route POST /invoke
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Function Name","name":"functionName","required":true,"dictionary":"listFunctionsDictionary","description":"The name or ARN of the function to invoke."}
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":false,"description":"The event payload to pass to the function as plain JSON. Omit for functions that require no input."}
   * @paramDef {"type":"String","label":"Invocation Type","name":"invocationType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["RequestResponse","Event","DryRun"]}},"description":"RequestResponse (default) waits for the result. Event fires-and-forgets. DryRun validates parameters without running the function."}
   * @returns {Object}
   * @sampleResult {"statusCode":200,"functionError":null,"payload":{"result":"ok"}}
   */
  async invoke(functionName, payload, invocationType) {
    if (!functionName) throw new Error('functionName is required.')

    const path = '/2015-03-31/functions/' + encodeURIComponent(functionName) + '/invocations'
    const type = invocationType || 'RequestResponse'
    const res = await this.invokeRaw(path, payload, type)

    if (res.statusCode >= 300) {
      parseJsonResponse(res)
    }

    const functionError = res.headers['x-amz-function-error'] || null
    let out = null

    if (res.body) {
      try {
        out = JSON.parse(res.body)
      } catch (_) {
        out = res.body
      }
    }

    return { statusCode: res.statusCode, functionError, payload: out }
  }

  /**
   * @operationName Get Function
   * @description Retrieves configuration details for a function, including runtime, handler, memory, timeout, state, and ARN.
   * @route POST /get-function
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Function Name","name":"functionName","required":true,"dictionary":"listFunctionsDictionary","description":"The name or ARN of the function to describe."}
   * @returns {Object}
   * @sampleResult {"functionName":"myFn","runtime":"nodejs20.x","handler":"index.handler","description":"My function","timeout":30,"memorySize":128,"codeSize":2048,"lastModified":"2026-01-01T00:00:00.000+0000","state":"Active","version":"$LATEST","role":"arn:aws:iam::123456789012:role/my-role","arn":"arn:aws:lambda:us-east-1:123456789012:function:myFn"}
   */
  async getFunction(functionName) {
    if (!functionName) throw new Error('functionName is required.')

    try {
      const res = await this.sendRest('GET', '/2015-03-31/functions/' + encodeURIComponent(functionName))
      const c = res.Configuration || {}

      return {
        functionName: c.FunctionName,
        runtime: c.Runtime,
        handler: c.Handler,
        description: c.Description,
        timeout: c.Timeout,
        memorySize: c.MemorySize,
        codeSize: c.CodeSize,
        lastModified: c.LastModified,
        state: c.State,
        version: c.Version,
        role: c.Role,
        arn: c.FunctionArn,
      }
    } catch (error) {
      this.#handleError('getFunction', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName List Functions
   * @description Provides a searchable list of deployed functions for use in other operations.
   * @route POST /list-functions-dictionary
   * @paramDef {"type":"listFunctionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"myFn","value":"myFn","note":"nodejs20.x"}],"cursor":null}
   */
  async listFunctionsDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      let path = '/2015-03-31/functions?MaxItems=50'

      if (cursor) path += `&Marker=${ encodeURIComponent(cursor) }`

      const res = await this.sendRest('GET', path)
      let functions = res.Functions || []

      if (search) {
        const lower = search.toLowerCase()

        functions = functions.filter(f => f.FunctionName.toLowerCase().includes(lower))
      }

      return {
        items: functions.map(f => ({ label: f.FunctionName, value: f.FunctionName, note: f.Runtime })),
        cursor: res.NextMarker || null,
      }
    } catch (error) {
      this.#handleError('listFunctionsDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'ResourceNotFoundException') {
      throw new Error(`Resource not found: ${ error.message }. Check the function name or ARN.`)
    }

    if (error && error.name === 'InvalidParameterValueException') {
      throw new Error(`Invalid parameter: ${ error.message }. Check the request parameters.`)
    }

    if (error && (error.name === 'TooManyRequestsException' || error.name === 'ThrottlingException')) {
      throw new Error(`Too many requests: ${ error.message }. Reduce request rate and retry with backoff.`)
    }

    if (error && error.name === 'ServiceException') {
      throw new Error(`Service error: ${ error.message }. Retry the request or contact AWS Support.`)
    }

    if (error && error.name === 'AccessDeniedException') {
      throw new Error(`Access denied: ${ error.message }. Check IAM permissions for the Lambda service.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(Lambda, awsConfigItems)
}

module.exports = { Lambda }
