'use strict'

const { elbRequest } = require('./elb-client')
const { toArray } = require('./xml')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

/**
 * @integrationName AWS Elastic Load Balancing
 * @integrationIcon /icon.svg
 */
class ElasticLoadBalancing {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('ELB')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { elbRequest }
  }

  async #send(action, params) {
    const creds = await this.credentials.resolve()

    return this.deps.elbRequest(action, params || {}, creds, this.region)
  }

  // Resolves a friendly dropdown label to its API value; passes through unknowns.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Extracts the *Result element from a parsed Query response document.
  #result(doc, action) {
    return (doc && doc[`${ action }Response`] && doc[`${ action }Response`][`${ action }Result`]) || {}
  }

  #shapeLoadBalancer(lb) {
    if (!lb || typeof lb !== 'object') return lb

    return {
      loadBalancerArn: lb.LoadBalancerArn,
      loadBalancerName: lb.LoadBalancerName,
      dnsName: lb.DNSName,
      canonicalHostedZoneId: lb.CanonicalHostedZoneId,
      createdTime: lb.CreatedTime,
      scheme: lb.Scheme,
      type: lb.Type,
      state: lb.State && lb.State.Code ? lb.State.Code : lb.State,
      vpcId: lb.VpcId,
      ipAddressType: lb.IpAddressType,
      securityGroups: toArray(lb.SecurityGroups),
      availabilityZones: toArray(lb.AvailabilityZones).map(az => ({
        zoneName: az.ZoneName,
        subnetId: az.SubnetId,
      })),
    }
  }

  #shapeTargetGroup(tg) {
    if (!tg || typeof tg !== 'object') return tg

    return {
      targetGroupArn: tg.TargetGroupArn,
      targetGroupName: tg.TargetGroupName,
      protocol: tg.Protocol,
      port: tg.Port ? Number(tg.Port) : tg.Port,
      vpcId: tg.VpcId,
      targetType: tg.TargetType,
      healthCheckProtocol: tg.HealthCheckProtocol,
      healthCheckPort: tg.HealthCheckPort,
      healthCheckPath: tg.HealthCheckPath,
      healthCheckEnabled: tg.HealthCheckEnabled,
      loadBalancerArns: toArray(tg.LoadBalancerArns),
    }
  }

  #shapeListener(l) {
    if (!l || typeof l !== 'object') return l

    return {
      listenerArn: l.ListenerArn,
      loadBalancerArn: l.LoadBalancerArn,
      protocol: l.Protocol,
      port: l.Port ? Number(l.Port) : l.Port,
      sslPolicy: l.SslPolicy,
      certificates: toArray(l.Certificates),
      defaultActions: toArray(l.DefaultActions),
    }
  }

  #shapeTargetHealth(d) {
    const target = d.Target || {}
    const health = d.TargetHealth || {}

    return {
      target: { id: target.Id, port: target.Port ? Number(target.Port) : target.Port, availabilityZone: target.AvailabilityZone },
      healthCheckPort: d.HealthCheckPort,
      state: health.State,
      reason: health.Reason,
      description: health.Description,
    }
  }

  #shapeTags(descriptions) {
    return toArray(descriptions).map(desc => ({
      resourceArn: desc.ResourceArn,
      tags: toArray(desc.Tags).map(t => ({ key: t.Key, value: t.Value })),
    }))
  }

  // ---------------------------------------------------------------------------
  // Load Balancers
  // ---------------------------------------------------------------------------

  /**
   * @operationName Describe Load Balancers
   * @description Lists Application, Network, and Gateway Load Balancers in the configured region. Filter by specific load balancer ARNs or names, or omit both to list all. Supports pagination via a marker returned in prior calls.
   * @category Load Balancers
   * @route GET /describe-load-balancers
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"Array<String>","label":"Load Balancer ARNs","name":"loadBalancerArns","required":false,"description":"Optional list of load balancer ARNs to describe. Cannot be combined with names."}
   * @paramDef {"type":"Array<String>","label":"Names","name":"names","required":false,"description":"Optional list of load balancer names to describe. Cannot be combined with ARNs."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results per page (1-400)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"loadBalancers":[{"loadBalancerArn":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc","loadBalancerName":"my-alb","dnsName":"my-alb-123.us-east-1.elb.amazonaws.com","scheme":"internet-facing","type":"application","state":"active","vpcId":"vpc-3ac0fb5f","securityGroups":["sg-5943793c"],"availabilityZones":[{"zoneName":"us-east-1a","subnetId":"subnet-8360a9e7"}]}],"marker":null}
   */
  async describeLoadBalancers(loadBalancerArns, names, pageSize, marker) {
    try {
      const params = {}

      if (Array.isArray(loadBalancerArns) && loadBalancerArns.length) params.LoadBalancerArns = loadBalancerArns
      if (Array.isArray(names) && names.length) params.Names = names
      if (pageSize) params.PageSize = pageSize
      if (marker) params.Marker = marker

      const doc = await this.#send('DescribeLoadBalancers', params)
      const result = this.#result(doc, 'DescribeLoadBalancers')

      return {
        loadBalancers: toArray(result.LoadBalancers).map(lb => this.#shapeLoadBalancer(lb)),
        marker: result.NextMarker || null,
      }
    } catch (error) {
      this.#handleError('describeLoadBalancers', error)
    }
  }

  /**
   * @operationName Create Load Balancer
   * @description Creates an Application, Network, or Gateway Load Balancer. Application and Network Load Balancers require subnets from the appropriate Availability Zones; security groups apply to Application and Network Load Balancers only. Scheme cannot be set for Gateway Load Balancers.
   * @category Load Balancers
   * @route POST /create-load-balancer
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Unique name (max 32 chars, alphanumeric or hyphens, no leading/trailing hyphen, cannot start with 'internal-')."}
   * @paramDef {"type":"Array<String>","label":"Subnets","name":"subnets","required":true,"description":"Subnet IDs to attach. Application Load Balancers require at least two Availability Zones."}
   * @paramDef {"type":"Array<String>","label":"Security Groups","name":"securityGroups","required":false,"description":"Security group IDs (Application and Network Load Balancers only)."}
   * @paramDef {"type":"String","label":"Scheme","name":"scheme","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Internet-Facing","Internal"]}},"defaultValue":"Internet-Facing","description":"Whether the load balancer is publicly reachable (Internet-Facing) or private (Internal). Not valid for Gateway Load Balancers."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Application","Network","Gateway"]}},"defaultValue":"Application","description":"The load balancer type."}
   * @paramDef {"type":"String","label":"IP Address Type","name":"ipAddressType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["IPv4","Dualstack"]}},"description":"IP address type. Internal load balancers must use IPv4."}
   * @returns {Object}
   * @sampleResult {"loadBalancer":{"loadBalancerArn":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc","loadBalancerName":"my-alb","dnsName":"my-alb-123.us-east-1.elb.amazonaws.com","scheme":"internet-facing","type":"application","state":"provisioning","vpcId":"vpc-3ac0fb5f","availabilityZones":[{"zoneName":"us-east-1a","subnetId":"subnet-8360a9e7"}]}}
   */
  async createLoadBalancer(name, subnets, securityGroups, scheme, type, ipAddressType) {
    if (!name) throw new Error('name is required.')
    if (!Array.isArray(subnets) || !subnets.length) throw new Error('subnets (at least one subnet ID) is required.')

    try {
      const params = { Name: name, Subnets: subnets }

      if (Array.isArray(securityGroups) && securityGroups.length) params.SecurityGroups = securityGroups

      const schemeValue = this.#resolveChoice(scheme, { 'Internet-Facing': 'internet-facing', Internal: 'internal' })
      const typeValue = this.#resolveChoice(type, { Application: 'application', Network: 'network', Gateway: 'gateway' })
      const ipValue = this.#resolveChoice(ipAddressType, { IPv4: 'ipv4', Dualstack: 'dualstack' })

      if (schemeValue) params.Scheme = schemeValue
      if (typeValue) params.Type = typeValue
      if (ipValue) params.IpAddressType = ipValue

      const doc = await this.#send('CreateLoadBalancer', params)
      const result = this.#result(doc, 'CreateLoadBalancer')

      return { loadBalancer: this.#shapeLoadBalancer(toArray(result.LoadBalancers)[0] || null) }
    } catch (error) {
      this.#handleError('createLoadBalancer', error)
    }
  }

  /**
   * @operationName Delete Load Balancer
   * @description Deletes the specified Application, Network, or Gateway Load Balancer. Its listeners are deleted as well, but associated target groups are not. Deletion may be blocked if deletion protection is enabled.
   * @category Load Balancers
   * @route DELETE /delete-load-balancer
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Load Balancer","name":"loadBalancerArn","required":true,"dictionary":"getLoadBalancersDictionary","description":"ARN of the load balancer to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"loadBalancerArn":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc"}
   */
  async deleteLoadBalancer(loadBalancerArn) {
    if (!loadBalancerArn) throw new Error('loadBalancerArn is required.')

    try {
      await this.#send('DeleteLoadBalancer', { LoadBalancerArn: loadBalancerArn })

      return { deleted: true, loadBalancerArn }
    } catch (error) {
      this.#handleError('deleteLoadBalancer', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Target Groups
  // ---------------------------------------------------------------------------

  /**
   * @operationName Describe Target Groups
   * @description Lists target groups in the region. Filter by target group ARNs, names, or by the load balancer they are attached to, or omit all filters to list every target group. Supports pagination.
   * @category Target Groups
   * @route GET /describe-target-groups
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Load Balancer","name":"loadBalancerArn","required":false,"dictionary":"getLoadBalancersDictionary","description":"Optional load balancer ARN to list only its target groups."}
   * @paramDef {"type":"Array<String>","label":"Target Group ARNs","name":"targetGroupArns","required":false,"description":"Optional list of target group ARNs to describe."}
   * @paramDef {"type":"Array<String>","label":"Names","name":"names","required":false,"description":"Optional list of target group names to describe."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results per page (1-400)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker returned by a previous call."}
   * @returns {Object}
   * @sampleResult {"targetGroups":[{"targetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2","targetGroupName":"my-targets","protocol":"HTTP","port":80,"vpcId":"vpc-3ac0fb5f","targetType":"instance","healthCheckProtocol":"HTTP","healthCheckPath":"/","loadBalancerArns":[]}],"marker":null}
   */
  async describeTargetGroups(loadBalancerArn, targetGroupArns, names, pageSize, marker) {
    try {
      const params = {}

      if (loadBalancerArn) params.LoadBalancerArn = loadBalancerArn
      if (Array.isArray(targetGroupArns) && targetGroupArns.length) params.TargetGroupArns = targetGroupArns
      if (Array.isArray(names) && names.length) params.Names = names
      if (pageSize) params.PageSize = pageSize
      if (marker) params.Marker = marker

      const doc = await this.#send('DescribeTargetGroups', params)
      const result = this.#result(doc, 'DescribeTargetGroups')

      return {
        targetGroups: toArray(result.TargetGroups).map(tg => this.#shapeTargetGroup(tg)),
        marker: result.NextMarker || null,
      }
    } catch (error) {
      this.#handleError('describeTargetGroups', error)
    }
  }

  /**
   * @operationName Create Target Group
   * @description Creates a target group used to route requests to registered targets. For Application and Network Load Balancers set Protocol and Port; use a VPC and Target Type appropriate for the routing method. Optional health check settings control how target health is evaluated.
   * @category Target Groups
   * @route POST /create-target-group
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Unique target group name (max 32 chars, alphanumeric or hyphens, no leading/trailing hyphen)."}
   * @paramDef {"type":"String","label":"Protocol","name":"protocol","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTTP","HTTPS","TCP","TLS","UDP","TCP_UDP","GENEVE"]}},"description":"Protocol for routing to targets. Not used for Lambda target groups."}
   * @paramDef {"type":"Number","label":"Port","name":"port","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Port on which targets receive traffic (1-65535). Not used for Lambda target groups."}
   * @paramDef {"type":"String","label":"VPC ID","name":"vpcId","required":false,"description":"Identifier of the VPC. Required unless the target type is 'lambda'."}
   * @paramDef {"type":"String","label":"Target Type","name":"targetType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Instance","IP","Lambda","ALB"]}},"defaultValue":"Instance","description":"How targets are specified: EC2 instance IDs, IP addresses, a Lambda function, or an Application Load Balancer."}
   * @paramDef {"type":"String","label":"Health Check Protocol","name":"healthCheckProtocol","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTTP","HTTPS","TCP","TLS","UDP","TCP_UDP","GENEVE"]}},"description":"Protocol used for health checks."}
   * @paramDef {"type":"String","label":"Health Check Path","name":"healthCheckPath","required":false,"description":"Destination path for HTTP/HTTPS health checks (e.g. /health)."}
   * @paramDef {"type":"Number","label":"Health Check Port","name":"healthCheckPort","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Port used for health checks. Defaults to the traffic port."}
   * @returns {Object}
   * @sampleResult {"targetGroup":{"targetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2","targetGroupName":"my-targets","protocol":"HTTP","port":80,"vpcId":"vpc-3ac0fb5f","targetType":"instance","healthCheckProtocol":"HTTP","healthCheckPath":"/","loadBalancerArns":[]}}
   */
  async createTargetGroup(name, protocol, port, vpcId, targetType, healthCheckProtocol, healthCheckPath, healthCheckPort) {
    if (!name) throw new Error('name is required.')

    try {
      const params = { Name: name }
      const protoValue = this.#resolveChoice(protocol, {})
      const targetTypeValue = this.#resolveChoice(targetType, { Instance: 'instance', IP: 'ip', Lambda: 'lambda', ALB: 'alb' })
      const hcProtoValue = this.#resolveChoice(healthCheckProtocol, {})

      if (protoValue) params.Protocol = protoValue
      if (port) params.Port = port
      if (vpcId) params.VpcId = vpcId
      if (targetTypeValue) params.TargetType = targetTypeValue
      if (hcProtoValue) params.HealthCheckProtocol = hcProtoValue
      if (healthCheckPath) params.HealthCheckPath = healthCheckPath
      if (healthCheckPort) params.HealthCheckPort = healthCheckPort

      const doc = await this.#send('CreateTargetGroup', params)
      const result = this.#result(doc, 'CreateTargetGroup')

      return { targetGroup: this.#shapeTargetGroup(toArray(result.TargetGroups)[0] || null) }
    } catch (error) {
      this.#handleError('createTargetGroup', error)
    }
  }

  /**
   * @operationName Modify Target Group
   * @description Updates the health check configuration of an existing target group, including the health check protocol, port, path, intervals, timeouts, and healthy/unhealthy thresholds. Only the supplied settings are changed.
   * @category Target Groups
   * @route PATCH /modify-target-group
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Target Group","name":"targetGroupArn","required":true,"dictionary":"getTargetGroupsDictionary","description":"ARN of the target group to modify."}
   * @paramDef {"type":"String","label":"Health Check Protocol","name":"healthCheckProtocol","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTTP","HTTPS","TCP","TLS","UDP","TCP_UDP","GENEVE"]}},"description":"Protocol used for health checks."}
   * @paramDef {"type":"String","label":"Health Check Path","name":"healthCheckPath","required":false,"description":"Destination path for HTTP/HTTPS health checks (e.g. /health)."}
   * @paramDef {"type":"Number","label":"Health Check Port","name":"healthCheckPort","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Port used for health checks."}
   * @paramDef {"type":"Number","label":"Health Check Interval (Seconds)","name":"healthCheckIntervalSeconds","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds between health checks."}
   * @paramDef {"type":"Number","label":"Health Check Timeout (Seconds)","name":"healthCheckTimeoutSeconds","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds to wait for a health check response before treating it as failed."}
   * @paramDef {"type":"Number","label":"Healthy Threshold","name":"healthyThresholdCount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Consecutive successful checks required to mark a target healthy."}
   * @paramDef {"type":"Number","label":"Unhealthy Threshold","name":"unhealthyThresholdCount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Consecutive failed checks required to mark a target unhealthy."}
   * @returns {Object}
   * @sampleResult {"targetGroup":{"targetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2","targetGroupName":"my-targets","protocol":"HTTP","port":80,"healthCheckProtocol":"HTTP","healthCheckPath":"/health","loadBalancerArns":[]}}
   */
  async modifyTargetGroup(targetGroupArn, healthCheckProtocol, healthCheckPath, healthCheckPort, healthCheckIntervalSeconds, healthCheckTimeoutSeconds, healthyThresholdCount, unhealthyThresholdCount) {
    if (!targetGroupArn) throw new Error('targetGroupArn is required.')

    try {
      const params = { TargetGroupArn: targetGroupArn }
      const hcProtoValue = this.#resolveChoice(healthCheckProtocol, {})

      if (hcProtoValue) params.HealthCheckProtocol = hcProtoValue
      if (healthCheckPath) params.HealthCheckPath = healthCheckPath
      if (healthCheckPort) params.HealthCheckPort = healthCheckPort
      if (healthCheckIntervalSeconds) params.HealthCheckIntervalSeconds = healthCheckIntervalSeconds
      if (healthCheckTimeoutSeconds) params.HealthCheckTimeoutSeconds = healthCheckTimeoutSeconds
      if (healthyThresholdCount) params.HealthyThresholdCount = healthyThresholdCount
      if (unhealthyThresholdCount) params.UnhealthyThresholdCount = unhealthyThresholdCount

      const doc = await this.#send('ModifyTargetGroup', params)
      const result = this.#result(doc, 'ModifyTargetGroup')

      return { targetGroup: this.#shapeTargetGroup(toArray(result.TargetGroups)[0] || null) }
    } catch (error) {
      this.#handleError('modifyTargetGroup', error)
    }
  }

  /**
   * @operationName Delete Target Group
   * @description Deletes the specified target group. The target group cannot be deleted while it is referenced by a listener or listener rule action.
   * @category Target Groups
   * @route DELETE /delete-target-group
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Target Group","name":"targetGroupArn","required":true,"dictionary":"getTargetGroupsDictionary","description":"ARN of the target group to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"targetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2"}
   */
  async deleteTargetGroup(targetGroupArn) {
    if (!targetGroupArn) throw new Error('targetGroupArn is required.')

    try {
      await this.#send('DeleteTargetGroup', { TargetGroupArn: targetGroupArn })

      return { deleted: true, targetGroupArn }
    } catch (error) {
      this.#handleError('deleteTargetGroup', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Target Health
  // ---------------------------------------------------------------------------

  /**
   * @operationName Describe Target Health
   * @description Reports the health of targets in a target group. Returns each target's state (healthy, unhealthy, initial, draining, unused, unavailable), along with a reason and description when a target is not healthy. Optionally scope the check to specific targets.
   * @category Target Health
   * @route GET /describe-target-health
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Target Group","name":"targetGroupArn","required":true,"dictionary":"getTargetGroupsDictionary","description":"ARN of the target group whose targets are checked."}
   * @paramDef {"type":"Array<Object>","label":"Targets","name":"targets","required":false,"description":"Optional specific targets to check, e.g. [{\"Id\":\"i-0f76fade\",\"Port\":80}]. Omit to check all registered targets."}
   * @returns {Object}
   * @sampleResult {"targetHealthDescriptions":[{"target":{"id":"i-0f76fade","port":80},"healthCheckPort":"80","state":"healthy"}]}
   */
  async describeTargetHealth(targetGroupArn, targets) {
    if (!targetGroupArn) throw new Error('targetGroupArn is required.')

    try {
      const params = { TargetGroupArn: targetGroupArn }

      if (Array.isArray(targets) && targets.length) params.Targets = targets

      const doc = await this.#send('DescribeTargetHealth', params)
      const result = this.#result(doc, 'DescribeTargetHealth')

      return {
        targetHealthDescriptions: toArray(result.TargetHealthDescriptions).map(d => this.#shapeTargetHealth(d)),
      }
    } catch (error) {
      this.#handleError('describeTargetHealth', error)
    }
  }

  /**
   * @operationName Register Targets
   * @description Registers one or more targets with a target group so the load balancer routes traffic to them. Provide targets as objects with an Id (instance ID, IP address, Lambda ARN, or ALB ARN) and an optional Port. After registration, targets pass through health checks before receiving traffic.
   * @category Target Health
   * @route POST /register-targets
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Target Group","name":"targetGroupArn","required":true,"dictionary":"getTargetGroupsDictionary","description":"ARN of the target group to register targets with."}
   * @paramDef {"type":"Array<Object>","label":"Targets","name":"targets","required":true,"description":"Targets to register, e.g. [{\"Id\":\"i-0f76fade\",\"Port\":80}]."}
   * @returns {Object}
   * @sampleResult {"registered":true,"targetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2","count":1}
   */
  async registerTargets(targetGroupArn, targets) {
    if (!targetGroupArn) throw new Error('targetGroupArn is required.')
    if (!Array.isArray(targets) || !targets.length) throw new Error('targets (at least one target) is required.')

    try {
      await this.#send('RegisterTargets', { TargetGroupArn: targetGroupArn, Targets: targets })

      return { registered: true, targetGroupArn, count: targets.length }
    } catch (error) {
      this.#handleError('registerTargets', error)
    }
  }

  /**
   * @operationName Deregister Targets
   * @description Deregisters one or more targets from a target group. The load balancer stops routing new requests to each target; in-flight requests are allowed to complete during the configured deregistration delay (connection draining).
   * @category Target Health
   * @route POST /deregister-targets
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Target Group","name":"targetGroupArn","required":true,"dictionary":"getTargetGroupsDictionary","description":"ARN of the target group to deregister targets from."}
   * @paramDef {"type":"Array<Object>","label":"Targets","name":"targets","required":true,"description":"Targets to deregister, e.g. [{\"Id\":\"i-0f76fade\",\"Port\":80}]."}
   * @returns {Object}
   * @sampleResult {"deregistered":true,"targetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2","count":1}
   */
  async deregisterTargets(targetGroupArn, targets) {
    if (!targetGroupArn) throw new Error('targetGroupArn is required.')
    if (!Array.isArray(targets) || !targets.length) throw new Error('targets (at least one target) is required.')

    try {
      await this.#send('DeregisterTargets', { TargetGroupArn: targetGroupArn, Targets: targets })

      return { deregistered: true, targetGroupArn, count: targets.length }
    } catch (error) {
      this.#handleError('deregisterTargets', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Listeners
  // ---------------------------------------------------------------------------

  /**
   * @operationName Describe Listeners
   * @description Lists the listeners for a load balancer, or describes specific listeners by ARN. Each listener includes its protocol, port, SSL policy, certificates, and default actions. Supports pagination.
   * @category Listeners
   * @route GET /describe-listeners
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Load Balancer","name":"loadBalancerArn","required":false,"dictionary":"getLoadBalancersDictionary","description":"ARN of the load balancer whose listeners to list. Provide this or listener ARNs."}
   * @paramDef {"type":"Array<String>","label":"Listener ARNs","name":"listenerArns","required":false,"description":"Optional list of specific listener ARNs to describe."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results per page (1-400)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker returned by a previous call."}
   * @returns {Object}
   * @sampleResult {"listeners":[{"listenerArn":"arn:aws:elasticloadbalancing:us-east-1:123:listener/app/my-alb/50dc/abc","loadBalancerArn":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc","protocol":"HTTP","port":80,"defaultActions":[{"Type":"forward","TargetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2"}]}],"marker":null}
   */
  async describeListeners(loadBalancerArn, listenerArns, pageSize, marker) {
    try {
      const params = {}

      if (loadBalancerArn) params.LoadBalancerArn = loadBalancerArn
      if (Array.isArray(listenerArns) && listenerArns.length) params.ListenerArns = listenerArns
      if (pageSize) params.PageSize = pageSize
      if (marker) params.Marker = marker

      const doc = await this.#send('DescribeListeners', params)
      const result = this.#result(doc, 'DescribeListeners')

      return {
        listeners: toArray(result.Listeners).map(l => this.#shapeListener(l)),
        marker: result.NextMarker || null,
      }
    } catch (error) {
      this.#handleError('describeListeners', error)
    }
  }

  /**
   * @operationName Create Listener
   * @description Creates a listener on a load balancer that checks for connection requests on the given protocol and port and forwards them using the supplied default actions. Provide default actions as the raw ELB action objects (e.g. a forward action to a target group).
   * @category Listeners
   * @route POST /create-listener
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Load Balancer","name":"loadBalancerArn","required":true,"dictionary":"getLoadBalancersDictionary","description":"ARN of the load balancer to attach the listener to."}
   * @paramDef {"type":"String","label":"Protocol","name":"protocol","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTTP","HTTPS","TCP","TLS","UDP","TCP_UDP"]}},"description":"Connection protocol for the listener."}
   * @paramDef {"type":"Number","label":"Port","name":"port","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Connection port for the listener (1-65535)."}
   * @paramDef {"type":"Array<Object>","label":"Default Actions","name":"defaultActions","required":true,"description":"Actions for the default rule, as raw ELB action objects, e.g. [{\"Type\":\"forward\",\"TargetGroupArn\":\"arn:...:targetgroup/my-targets/73e2\"}]."}
   * @returns {Object}
   * @sampleResult {"listener":{"listenerArn":"arn:aws:elasticloadbalancing:us-east-1:123:listener/app/my-alb/50dc/abc","loadBalancerArn":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc","protocol":"HTTP","port":80,"defaultActions":[{"Type":"forward","TargetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2"}]}}
   */
  async createListener(loadBalancerArn, protocol, port, defaultActions) {
    if (!loadBalancerArn) throw new Error('loadBalancerArn is required.')
    if (!protocol) throw new Error('protocol is required.')
    if (!port) throw new Error('port is required.')
    if (!Array.isArray(defaultActions) || !defaultActions.length) throw new Error('defaultActions (at least one action) is required.')

    try {
      const params = {
        LoadBalancerArn: loadBalancerArn,
        Protocol: this.#resolveChoice(protocol, {}),
        Port: port,
        DefaultActions: defaultActions,
      }

      const doc = await this.#send('CreateListener', params)
      const result = this.#result(doc, 'CreateListener')

      return { listener: this.#shapeListener(toArray(result.Listeners)[0] || null) }
    } catch (error) {
      this.#handleError('createListener', error)
    }
  }

  /**
   * @operationName Modify Listener
   * @description Replaces properties of an existing listener. Supply only the fields to change: the protocol, port, and/or default actions. Unspecified properties are left unchanged.
   * @category Listeners
   * @route PATCH /modify-listener
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Listener ARN","name":"listenerArn","required":true,"description":"ARN of the listener to modify."}
   * @paramDef {"type":"String","label":"Protocol","name":"protocol","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTTP","HTTPS","TCP","TLS","UDP","TCP_UDP"]}},"description":"New connection protocol for the listener."}
   * @paramDef {"type":"Number","label":"Port","name":"port","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New connection port for the listener (1-65535)."}
   * @paramDef {"type":"Array<Object>","label":"Default Actions","name":"defaultActions","required":false,"description":"New default rule actions, as raw ELB action objects."}
   * @returns {Object}
   * @sampleResult {"listener":{"listenerArn":"arn:aws:elasticloadbalancing:us-east-1:123:listener/app/my-alb/50dc/abc","loadBalancerArn":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc","protocol":"HTTPS","port":443,"defaultActions":[{"Type":"forward","TargetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2"}]}}
   */
  async modifyListener(listenerArn, protocol, port, defaultActions) {
    if (!listenerArn) throw new Error('listenerArn is required.')

    try {
      const params = { ListenerArn: listenerArn }
      const protoValue = this.#resolveChoice(protocol, {})

      if (protoValue) params.Protocol = protoValue
      if (port) params.Port = port
      if (Array.isArray(defaultActions) && defaultActions.length) params.DefaultActions = defaultActions

      const doc = await this.#send('ModifyListener', params)
      const result = this.#result(doc, 'ModifyListener')

      return { listener: this.#shapeListener(toArray(result.Listeners)[0] || null) }
    } catch (error) {
      this.#handleError('modifyListener', error)
    }
  }

  /**
   * @operationName Delete Listener
   * @description Deletes the specified listener. The listener's rules are deleted as well; the load balancer and its target groups are not affected.
   * @category Listeners
   * @route DELETE /delete-listener
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Listener ARN","name":"listenerArn","required":true,"description":"ARN of the listener to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"listenerArn":"arn:aws:elasticloadbalancing:us-east-1:123:listener/app/my-alb/50dc/abc"}
   */
  async deleteListener(listenerArn) {
    if (!listenerArn) throw new Error('listenerArn is required.')

    try {
      await this.#send('DeleteListener', { ListenerArn: listenerArn })

      return { deleted: true, listenerArn }
    } catch (error) {
      this.#handleError('deleteListener', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------

  /**
   * @operationName Describe Rules
   * @description Lists the rules for a listener, or describes specific rules by ARN. Each rule includes its priority, conditions, actions, and whether it is the default rule. Supports pagination.
   * @category Rules
   * @route GET /describe-rules
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"String","label":"Listener ARN","name":"listenerArn","required":false,"description":"ARN of the listener whose rules to list. Provide this or rule ARNs."}
   * @paramDef {"type":"Array<String>","label":"Rule ARNs","name":"ruleArns","required":false,"description":"Optional list of specific rule ARNs to describe."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results per page (1-400)."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker returned by a previous call."}
   * @returns {Object}
   * @sampleResult {"rules":[{"ruleArn":"arn:aws:elasticloadbalancing:us-east-1:123:listener-rule/app/my-alb/50dc/abc/def","priority":"1","isDefault":false,"conditions":[{"Field":"path-pattern","Values":{"member":"/img/*"}}],"actions":[{"Type":"forward","TargetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2"}]}],"marker":null}
   */
  async describeRules(listenerArn, ruleArns, pageSize, marker) {
    try {
      const params = {}

      if (listenerArn) params.ListenerArn = listenerArn
      if (Array.isArray(ruleArns) && ruleArns.length) params.RuleArns = ruleArns
      if (pageSize) params.PageSize = pageSize
      if (marker) params.Marker = marker

      const doc = await this.#send('DescribeRules', params)
      const result = this.#result(doc, 'DescribeRules')

      return {
        rules: toArray(result.Rules).map(r => ({
          ruleArn: r.RuleArn,
          priority: r.Priority,
          isDefault: r.IsDefault === 'true' || r.IsDefault === true,
          conditions: toArray(r.Conditions),
          actions: toArray(r.Actions),
        })),
        marker: result.NextMarker || null,
      }
    } catch (error) {
      this.#handleError('describeRules', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------

  /**
   * @operationName Describe Tags
   * @description Returns the tags for the specified ELB resources (load balancers, target groups, listeners, or rules). Provide one or more resource ARNs and receive their tag key/value pairs.
   * @category Tags
   * @route GET /describe-tags
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"Array<String>","label":"Resource ARNs","name":"resourceArns","required":true,"description":"ARNs of the resources whose tags to retrieve."}
   * @returns {Object}
   * @sampleResult {"tagDescriptions":[{"resourceArn":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc","tags":[{"key":"env","value":"prod"}]}]}
   */
  async describeTags(resourceArns) {
    if (!Array.isArray(resourceArns) || !resourceArns.length) throw new Error('resourceArns (at least one ARN) is required.')

    try {
      const doc = await this.#send('DescribeTags', { ResourceArns: resourceArns })
      const result = this.#result(doc, 'DescribeTags')

      return { tagDescriptions: this.#shapeTags(result.TagDescriptions) }
    } catch (error) {
      this.#handleError('describeTags', error)
    }
  }

  /**
   * @operationName Add Tags
   * @description Adds or updates tags on the specified ELB resources. Existing tags with the same key are overwritten. Provide tags as key/value objects.
   * @category Tags
   * @route POST /add-tags
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"Array<String>","label":"Resource ARNs","name":"resourceArns","required":true,"description":"ARNs of the resources to tag."}
   * @paramDef {"type":"Array<Object>","label":"Tags","name":"tags","required":true,"description":"Tags to add, as objects, e.g. [{\"Key\":\"env\",\"Value\":\"prod\"}]."}
   * @returns {Object}
   * @sampleResult {"tagged":true,"resourceArns":["arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc"]}
   */
  async addTags(resourceArns, tags) {
    if (!Array.isArray(resourceArns) || !resourceArns.length) throw new Error('resourceArns (at least one ARN) is required.')
    if (!Array.isArray(tags) || !tags.length) throw new Error('tags (at least one tag) is required.')

    try {
      await this.#send('AddTags', { ResourceArns: resourceArns, Tags: tags })

      return { tagged: true, resourceArns }
    } catch (error) {
      this.#handleError('addTags', error)
    }
  }

  /**
   * @operationName Remove Tags
   * @description Removes the specified tag keys from the given ELB resources. Tag keys that are not present are ignored.
   * @category Tags
   * @route POST /remove-tags
   * @appearanceColor #8C4FFF #B388FF
   * @paramDef {"type":"Array<String>","label":"Resource ARNs","name":"resourceArns","required":true,"description":"ARNs of the resources to untag."}
   * @paramDef {"type":"Array<String>","label":"Tag Keys","name":"tagKeys","required":true,"description":"Tag keys to remove, e.g. [\"env\",\"team\"]."}
   * @returns {Object}
   * @sampleResult {"removed":true,"resourceArns":["arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc"]}
   */
  async removeTags(resourceArns, tagKeys) {
    if (!Array.isArray(resourceArns) || !resourceArns.length) throw new Error('resourceArns (at least one ARN) is required.')
    if (!Array.isArray(tagKeys) || !tagKeys.length) throw new Error('tagKeys (at least one key) is required.')

    try {
      await this.#send('RemoveTags', { ResourceArns: resourceArns, TagKeys: tagKeys })

      return { removed: true, resourceArns }
    } catch (error) {
      this.#handleError('removeTags', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Get Load Balancers Dictionary
   * @description Provides a searchable list of load balancers (label = name, value = ARN) for dynamic dropdown selection in other operations.
   * @route POST /get-load-balancers-dictionary
   * @paramDef {"type":"getLoadBalancersDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my-alb","value":"arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/50dc","note":"application"}],"cursor":null}
   */
  async getLoadBalancersDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const params = { PageSize: 400 }

      if (cursor) params.Marker = cursor

      const doc = await this.#send('DescribeLoadBalancers', params)
      const result = this.#result(doc, 'DescribeLoadBalancers')
      let items = toArray(result.LoadBalancers).map(lb => ({
        label: lb.LoadBalancerName,
        value: lb.LoadBalancerArn,
        note: lb.Type,
      }))

      if (search) {
        const lower = search.toLowerCase()

        items = items.filter(item => (item.label || '').toLowerCase().includes(lower))
      }

      return { items, cursor: result.NextMarker || null }
    } catch (error) {
      this.#handleError('getLoadBalancersDictionary', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Target Groups Dictionary
   * @description Provides a searchable list of target groups (label = name, value = ARN) for dynamic dropdown selection in other operations.
   * @route POST /get-target-groups-dictionary
   * @paramDef {"type":"getTargetGroupsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my-targets","value":"arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-targets/73e2","note":"HTTP:80"}],"cursor":null}
   */
  async getTargetGroupsDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const params = { PageSize: 400 }

      if (cursor) params.Marker = cursor

      const doc = await this.#send('DescribeTargetGroups', params)
      const result = this.#result(doc, 'DescribeTargetGroups')
      let items = toArray(result.TargetGroups).map(tg => ({
        label: tg.TargetGroupName,
        value: tg.TargetGroupArn,
        note: tg.Protocol && tg.Port ? `${ tg.Protocol }:${ tg.Port }` : tg.TargetType,
      }))

      if (search) {
        const lower = search.toLowerCase()

        items = items.filter(item => (item.label || '').toLowerCase().includes(lower))
      }

      return { items, cursor: result.NextMarker || null }
    } catch (error) {
      this.#handleError('getTargetGroupsDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    const name = error && error.name

    if (name === 'LoadBalancerNotFound') {
      throw new Error(`Load balancer not found: ${ error.message }. Check the load balancer ARN.`)
    }

    if (name === 'TargetGroupNotFound') {
      throw new Error(`Target group not found: ${ error.message }. Check the target group ARN.`)
    }

    if (name === 'ListenerNotFound' || name === 'RuleNotFound') {
      throw new Error(`Resource not found: ${ error.message }. Check the ARN.`)
    }

    if (name === 'DuplicateLoadBalancerName' || name === 'DuplicateTargetGroupName') {
      throw new Error(`Name already in use: ${ error.message }. Choose a different name.`)
    }

    if (name === 'ValidationError' || name === 'InvalidConfigurationRequest') {
      throw new Error(`Invalid request: ${ error.message }. Check the supplied parameters.`)
    }

    if (name === 'ResourceInUse') {
      throw new Error(`Resource in use: ${ error.message }. It is referenced by another resource and cannot be modified or deleted.`)
    }

    throw mapAwsError(error)
  }
}

/**
 * @typedef {Object} getLoadBalancersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter load balancers by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination marker from a previous call."}
 */

/**
 * @typedef {Object} getTargetGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter target groups by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination marker from a previous call."}
 */

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(ElasticLoadBalancing, awsConfigItems)
}

module.exports = { ElasticLoadBalancing }
