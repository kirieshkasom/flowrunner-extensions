'use strict'

const API_BASE_URL = 'https://api.intacct.com/ia/api/v1'
const OAUTH_AUTH_URL = `${ API_BASE_URL }/oauth2/authorize`
const TOKEN_URL = `${ API_BASE_URL }/oauth2/token`
const DEFAULT_SCOPE = 'offline_access'
const DEFAULT_LIMIT = 100

// Friendly DROPDOWN labels the UI shows, mapped to the API values Sage Intacct expects.
const REVENUE_ADJUSTMENT_TYPE_MAP = {
  'Template': 'template',
  'One Time': 'oneTime',
  'Distributed': 'distributed',
  'Walk Forward': 'walkForward',
}

const logger = {
  info: (...args) => console.log('[sage-intacct] info:', ...args),
  debug: (...args) => console.log('[sage-intacct] debug:', ...args),
  error: (...args) => console.log('[sage-intacct] error:', ...args),
  warn: (...args) => console.log('[sage-intacct] warn:', ...args),
}

function cleanupObject(obj) {
  const result = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

const OBJECT_TYPES = [
  {
    value: 'accounts-payable/account-label',
    label: 'Account Label',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/adjustment',
    label: 'Adjustment',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/adjustment-line',
    label: 'Adjustment Line',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/adjustment-summary',
    label: 'Adjustment Summary',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/adjustment-tax-entry',
    label: 'Adjustment Tax Entry',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/advance',
    label: 'Advance',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/advance-line',
    label: 'Advance Line',
    module: 'Accounts Payable',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/bill',
    label: 'Bill',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/bill-line',
    label: 'Bill Line',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/bill-summary',
    label: 'Bill Summary',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/bill-tax-entry',
    label: 'Bill Tax Entry',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/check-run',
    label: 'Check Run',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/joint-payee',
    label: 'Joint Payee',
    module: 'Accounts Payable',
    ops: ['list', 'create'],
  },
  {
    value: 'accounts-payable/payment',
    label: 'Payment',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/payment-detail',
    label: 'Payment Detail',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/payment-line',
    label: 'Payment Line',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/recurring-bill',
    label: 'Recurring Bill',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/recurring-bill-line',
    label: 'Recurring Bill Line',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/recurring-bill-tax-entry',
    label: 'Recurring Bill Tax Entry',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/summary',
    label: 'Summary',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/term',
    label: 'Term',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/vendor',
    label: 'Vendor',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/vendor-account-number',
    label: 'Vendor Account Number',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/vendor-bank-file-setup',
    label: 'Vendor Bank File Setup',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/vendor-contact',
    label: 'Vendor Contact',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/vendor-email-template',
    label: 'Vendor Email Template',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/vendor-group',
    label: 'Vendor Group',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-payable/vendor-payment-provider',
    label: 'Vendor Payment Provider',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'accounts-payable/vendor-restricted-department',
    label: 'Vendor Restricted Department',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/vendor-restricted-location',
    label: 'Vendor Restricted Location',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/vendor-total',
    label: 'Vendor Total',
    module: 'Accounts Payable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-payable/vendor-type',
    label: 'Vendor Type',
    module: 'Accounts Payable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/account-label',
    label: 'Account Label',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/adjustment',
    label: 'Adjustment',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/adjustment-line',
    label: 'Adjustment Line',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/adjustment-tax-entry',
    label: 'Adjustment Tax Entry',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/advance',
    label: 'Advance',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/advance-line',
    label: 'Advance Line',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'accounts-receivable/billback-template',
    label: 'Billback Template',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/billback-template-line',
    label: 'Billback Template Line',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/customer',
    label: 'Customer',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/customer-contact',
    label: 'Customer Contact',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/customer-email-template',
    label: 'Customer Email Template',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/customer-group',
    label: 'Customer Group',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/customer-item-cross-reference',
    label: 'Customer Item Cross Reference',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/customer-message',
    label: 'Customer Message',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'accounts-receivable/customer-refund',
    label: 'Customer Refund',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/customer-refund-detail',
    label: 'Customer Refund Detail',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/customer-refund-line',
    label: 'Customer Refund Line',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/customer-restricted-department',
    label: 'Customer Restricted Department',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/customer-restricted-location',
    label: 'Customer Restricted Location',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/customer-total',
    label: 'Customer Total',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/customer-type',
    label: 'Customer Type',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/delivery-history',
    label: 'Delivery History',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/dunning-customer',
    label: 'Dunning Customer',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/dunning-invoice',
    label: 'Dunning Invoice',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/dunning-level',
    label: 'Dunning Level',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/dunning-notice',
    label: 'Dunning Notice',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get'],
  },
  {
    value: 'accounts-receivable/invoice',
    label: 'Invoice',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/invoice-line',
    label: 'Invoice Line',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/invoice-summary',
    label: 'Invoice Summary',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/invoice-tax-entry',
    label: 'Invoice Tax Entry',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/manual-deposit',
    label: 'Manual Deposit',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get'],
  },
  {
    value: 'accounts-receivable/manual-deposit-line',
    label: 'Manual Deposit Line',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/manual-deposit-summary',
    label: 'Manual Deposit Summary',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/payment',
    label: 'Payment',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'delete'],
  },
  {
    value: 'accounts-receivable/payment-detail',
    label: 'Payment Detail',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/payment-line',
    label: 'Payment Line',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/payment-summary',
    label: 'Payment Summary',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/recurring-invoice',
    label: 'Recurring Invoice',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/recurring-invoice-line',
    label: 'Recurring Invoice Line',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/recurring-invoice-tax-entry',
    label: 'Recurring Invoice Tax Entry',
    module: 'Accounts Receivable',
    ops: ['list', 'get'],
  },
  {
    value: 'accounts-receivable/revenue-recognition-template',
    label: 'Revenue Recognition Template',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/shipping-method',
    label: 'Shipping Method',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/summary',
    label: 'Summary',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/term',
    label: 'Term',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/territory',
    label: 'Territory',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'accounts-receivable/territory-group',
    label: 'Territory Group',
    module: 'Accounts Receivable',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/ar-advance-txn-line-template',
    label: 'Ar Advance Txn Line Template',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/ar-advance-txn-template',
    label: 'Ar Advance Txn Template',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/bank-account',
    label: 'Bank Account',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-fee',
    label: 'Bank Fee',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'cash-management/bank-fee-line',
    label: 'Bank Fee Line',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-fee-tax-entry',
    label: 'Bank Fee Tax Entry',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-feed',
    label: 'Bank Feed',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'delete'],
  },
  {
    value: 'cash-management/bank-file',
    label: 'Bank File',
    module: 'Cash Management',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'cash-management/bank-file-detail',
    label: 'Bank File Detail',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-reconciliation',
    label: 'Bank Reconciliation',
    module: 'Cash Management',
    ops: ['list', 'create', 'get'],
  },
  {
    value: 'cash-management/bank-reconciliation-record',
    label: 'Bank Reconciliation Record',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-transaction',
    label: 'Bank Transaction',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-txn-assignment-rule',
    label: 'Bank Txn Assignment Rule',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/bank-txn-assignment-rule-filter',
    label: 'Bank Txn Assignment Rule Filter',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-txn-rule',
    label: 'Bank Txn Rule',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/bank-txn-rule-filter',
    label: 'Bank Txn Rule Filter',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-txn-rule-group',
    label: 'Bank Txn Rule Group',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-txn-rule-map',
    label: 'Bank Txn Rule Map',
    module: 'Cash Management',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'cash-management/bank-txn-rule-match',
    label: 'Bank Txn Rule Match',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-txn-rule-set',
    label: 'Bank Txn Rule Set',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/bank-txn-rule-set-run-detail',
    label: 'Bank Txn Rule Set Run Detail',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/bank-txn-rule-set-run-log',
    label: 'Bank Txn Rule Set Run Log',
    module: 'Cash Management',
    ops: ['list', 'create', 'get'],
  },
  {
    value: 'cash-management/checking-account',
    label: 'Checking Account',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/credit-card-account',
    label: 'Credit Card Account',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/credit-card-fee',
    label: 'Credit Card Fee',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'cash-management/credit-card-fee-line',
    label: 'Credit Card Fee Line',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/credit-card-fee-tax-entry',
    label: 'Credit Card Fee Tax Entry',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/credit-card-reconciliation',
    label: 'Credit Card Reconciliation',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'delete'],
  },
  {
    value: 'cash-management/credit-card-reconciliation-record',
    label: 'Credit Card Reconciliation Record',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/credit-card-txn',
    label: 'Credit Card Txn',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/credit-card-txn-line',
    label: 'Credit Card Txn Line',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/credit-card-txn-line-template',
    label: 'Credit Card Txn Line Template',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/credit-card-txn-tax-entry',
    label: 'Credit Card Txn Tax Entry',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/credit-card-txn-template',
    label: 'Credit Card Txn Template',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/deposit',
    label: 'Deposit',
    module: 'Cash Management',
    ops: ['list', 'create', 'get'],
  },
  {
    value: 'cash-management/deposit-detail',
    label: 'Deposit Detail',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/deposit-line',
    label: 'Deposit Line',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/financial-institution',
    label: 'Financial Institution',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/funds-transfer',
    label: 'Funds Transfer',
    module: 'Cash Management',
    ops: ['list', 'create', 'get'],
  },
  {
    value: 'cash-management/funds-transfer-line',
    label: 'Funds Transfer Line',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/journal-entry-line-template',
    label: 'Journal Entry Line Template',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/journal-entry-template',
    label: 'Journal Entry Template',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/other-receipt',
    label: 'Other Receipt',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/other-receipt-line',
    label: 'Other Receipt Line',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/other-receipt-tax-entry',
    label: 'Other Receipt Tax Entry',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/payment-provider',
    label: 'Payment Provider',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/payment-provider-bank-account',
    label: 'Payment Provider Bank Account',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'cash-management/provider-payment-method',
    label: 'Provider Payment Method',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/received-payment',
    label: 'Received Payment',
    module: 'Cash Management',
    ops: ['list', 'create', 'get'],
  },
  {
    value: 'cash-management/received-payment-line',
    label: 'Received Payment Line',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'cash-management/savings-account',
    label: 'Savings Account',
    module: 'Cash Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'cash-management/undeposited-fund',
    label: 'Undeposited Fund',
    module: 'Cash Management',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/advanced-audit-history',
    label: 'Advanced Audit History',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/affiliate-entity',
    label: 'Affiliate Entity',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/affiliate-entity-group',
    label: 'Affiliate Entity Group',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/attachment',
    label: 'Attachment',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/audit-history',
    label: 'Audit History',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/class',
    label: 'Class',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/cloud-storage',
    label: 'Cloud Storage',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/contact',
    label: 'Contact',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/contact-version',
    label: 'Contact Version',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/department',
    label: 'Department',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/department-group',
    label: 'Department Group',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/department-group-member',
    label: 'Department Group Member',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/document-sequence',
    label: 'Document Sequence',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/document-sequence-rollover',
    label: 'Document Sequence Rollover',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/earning-type',
    label: 'Earning Type',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/email-delivery-record',
    label: 'Email Delivery Record',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/email-template',
    label: 'Email Template',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/employee',
    label: 'Employee',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/employee-bank-file-setup',
    label: 'Employee Bank File Setup',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/employee-group',
    label: 'Employee Group',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/employee-rate',
    label: 'Employee Rate',
    module: 'Company Configuration',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'company-config/employee-type',
    label: 'Employee Type',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/entity',
    label: 'Entity',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/exchange-rate',
    label: 'Exchange Rate',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/exchange-rate-line',
    label: 'Exchange Rate Line',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/exchange-rate-type',
    label: 'Exchange Rate Type',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/folder',
    label: 'Folder',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/inter-entity-account-mapping',
    label: 'Inter Entity Account Mapping',
    module: 'Company Configuration',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'company-config/inter-entity-advanced-map',
    label: 'Inter Entity Advanced Map',
    module: 'Company Configuration',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'company-config/inter-entity-basic-map',
    label: 'Inter Entity Basic Map',
    module: 'Company Configuration',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'company-config/location',
    label: 'Location',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/location-group',
    label: 'Location Group',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/location-group-member',
    label: 'Location Group Member',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/permission',
    label: 'Permission',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/role',
    label: 'Role',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/role-permission-assignment',
    label: 'Role Permission Assignment',
    module: 'Company Configuration',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'company-config/role-user-group-map',
    label: 'Role User Group Map',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/role-user-map',
    label: 'Role User Map',
    module: 'Company Configuration',
    ops: ['list', 'get'],
  },
  {
    value: 'company-config/user',
    label: 'User',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'company-config/user-group',
    label: 'User Group',
    module: 'Company Configuration',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'consolidation/adjustment-journal',
    label: 'Adjustment Journal',
    module: 'Consolidations',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'consolidation/book',
    label: 'Book',
    module: 'Consolidations',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'consolidation/elimination-account',
    label: 'Elimination Account',
    module: 'Consolidations',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'consolidation/entity',
    label: 'Entity',
    module: 'Consolidations',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'consolidation/override-account',
    label: 'Override Account',
    module: 'Consolidations',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'consolidation/ownership-structure',
    label: 'Ownership Structure',
    module: 'Consolidations',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/accumulation-type',
    label: 'Accumulation Type',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/ap-releasable-retainage',
    label: 'Ap Releasable Retainage',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/ap-retainage-release',
    label: 'Ap Retainage Release',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/ap-retainage-release-line',
    label: 'Ap Retainage Release Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/ar-releasable-retainage',
    label: 'Ar Releasable Retainage',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/ar-retainage-release',
    label: 'Ar Retainage Release',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/ar-retainage-release-line',
    label: 'Ar Retainage Release Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/change-request',
    label: 'Change Request',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/change-request-line',
    label: 'Change Request Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/change-request-status',
    label: 'Change Request Status',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/change-request-type',
    label: 'Change Request Type',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/compliance-definition',
    label: 'Compliance Definition',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/compliance-definition-association',
    label: 'Compliance Definition Association',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/compliance-record',
    label: 'Compliance Record',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/compliance-type',
    label: 'Compliance Type',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/cost-type-observed-percent-completed',
    label: 'Cost Type Observed Percent Completed',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/employee-position',
    label: 'Employee Position',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/labor-class',
    label: 'Labor Class',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/labor-shift',
    label: 'Labor Shift',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/labor-union',
    label: 'Labor Union',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/project-change-order',
    label: 'Project Change Order',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/project-contract',
    label: 'Project Contract',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/project-contract-billing-invoice-detail',
    label: 'Project Contract Billing Invoice Detail',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/project-contract-billing-invoice-summary',
    label: 'Project Contract Billing Invoice Summary',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/project-contract-line',
    label: 'Project Contract Line',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/project-contract-line-entry',
    label: 'Project Contract Line Entry',
    module: 'Construction',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'construction/project-contract-line-task-map',
    label: 'Project Contract Line Task Map',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'delete'],
  },
  {
    value: 'construction/project-contract-type',
    label: 'Project Contract Type',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/project-estimate',
    label: 'Project Estimate',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/project-estimate-line',
    label: 'Project Estimate Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/project-estimate-type',
    label: 'Project Estimate Type',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/rate-table',
    label: 'Rate Table',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/rate-table-accounts-payable-line',
    label: 'Rate Table Accounts Payable Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/rate-table-credit-card-line',
    label: 'Rate Table Credit Card Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/rate-table-employee-expense-line',
    label: 'Rate Table Employee Expense Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/rate-table-journal-line',
    label: 'Rate Table Journal Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/rate-table-purchasing-line',
    label: 'Rate Table Purchasing Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction/rate-table-timesheet-line',
    label: 'Rate Table Timesheet Line',
    module: 'Construction',
    ops: ['list', 'get'],
  },
  {
    value: 'construction-forecasting/wip-forecast-detail',
    label: 'Wip Forecast Detail',
    module: 'Construction',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'construction-forecasting/wip-period',
    label: 'Wip Period',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction-forecasting/wip-project',
    label: 'Wip Project',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'construction-forecasting/wip-project-manager-forecast',
    label: 'Wip Project Manager Forecast',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction-forecasting/wip-setup',
    label: 'Wip Setup',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update'],
  },
  {
    value: 'construction-forecasting/wip-setup-account',
    label: 'Wip Setup Account',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/work-order',
    label: 'Work Order',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/work-order-call-type',
    label: 'Work Order Call Type',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/work-order-problem-code',
    label: 'Work Order Problem Code',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/work-order-state',
    label: 'Work Order State',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/work-order-type',
    label: 'Work Order Type',
    module: 'Construction',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/billing-price-list',
    label: 'Billing Price List',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/billing-price-list-entry',
    label: 'Billing Price List Entry',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/billing-price-list-entry-line',
    label: 'Billing Price List Entry Line',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/billing-price-list-entry-line-tier',
    label: 'Billing Price List Entry Line Tier',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/billing-schedule',
    label: 'Billing Schedule',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'contracts/billing-schedule-line',
    label: 'Billing Schedule Line',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get'],
  },
  {
    value: 'contracts/billing-template',
    label: 'Billing Template',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/billing-template-line',
    label: 'Billing Template Line',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get'],
  },
  {
    value: 'contracts/contract',
    label: 'Contract',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/contract-line',
    label: 'Contract Line',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/contract-type',
    label: 'Contract Type',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/contract-usage',
    label: 'Contract Usage',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/evergreen-template',
    label: 'Evergreen Template',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/expense-template',
    label: 'Expense Template',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/expense-template-line',
    label: 'Expense Template Line',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get'],
  },
  {
    value: 'contracts/mea-category',
    label: 'Mea Category',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/mea-price-list',
    label: 'Mea Price List',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/mea-price-list-entry',
    label: 'Mea Price List Entry',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/mea-price-list-entry-line',
    label: 'Mea Price List Entry Line',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'contracts/revenue-schedule',
    label: 'Revenue Schedule',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'contracts/revenue-schedule-line',
    label: 'Revenue Schedule Line',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'get'],
  },
  {
    value: 'contracts/revenue-template',
    label: 'Revenue Template',
    module: 'Contracts and Revenue Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/employee-expense',
    label: 'Expense Report',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/employee-expense-line',
    label: 'Expense Report Line',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/employee-expense-summary',
    label: 'Expense Summary',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/employee-expense-type',
    label: 'Expense Type',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/employee-expense-payment-type',
    label: 'Expense Payment Type',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/employee-expense-adjustment',
    label: 'Expense Adjustment',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/employee-expense-adjustment-line',
    label: 'Expense Adjustment Line',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/unit-rate',
    label: 'Unit Rate',
    module: 'Expenses',
    ops: ['list', 'get'],
  },
  {
    value: 'expenses/electronic-receipt',
    label: 'Electronic Receipt',
    module: 'Expenses',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'expenses/electronic-receipt-line',
    label: 'Electronic Receipt Line',
    module: 'Expenses',
    ops: ['list', 'get'],
  },
  {
    value: 'expenses/expense-to-approve',
    label: 'Expense To Approve',
    module: 'Expenses',
    ops: ['list', 'get'],
  },
  {
    value: 'expenses/expense-to-approve-line',
    label: 'Expense To Approve Line',
    module: 'Expenses',
    ops: ['list', 'get'],
  },
  {
    value: 'fixed-assets/asset',
    label: 'Asset',
    module: 'Fixed Assets Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'fixed-assets/asset-classification',
    label: 'Asset Classification',
    module: 'Fixed Assets Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'fixed-assets/asset-depreciation-rule',
    label: 'Asset Depreciation Rule',
    module: 'Fixed Assets Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'fixed-assets/classification-depreciation-rule',
    label: 'Classification Depreciation Rule',
    module: 'Fixed Assets Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'fixed-assets/depreciation-method',
    label: 'Depreciation Method',
    module: 'Fixed Assets Management',
    ops: ['list', 'get'],
  },
  {
    value: 'fixed-assets/depreciation-schedule',
    label: 'Depreciation Schedule',
    module: 'Fixed Assets Management',
    ops: ['list', 'get'],
  },
  {
    value: 'fixed-assets/depreciation-schedule-entry',
    label: 'Depreciation Schedule Entry',
    module: 'Fixed Assets Management',
    ops: ['list', 'get'],
  },
  {
    value: 'fixed-assets/disposal',
    label: 'Disposal',
    module: 'Fixed Assets Management',
    ops: ['list', 'get'],
  },
  {
    value: 'fixed-assets/disposal-depreciation-schedule-map',
    label: 'Disposal Depreciation Schedule Map',
    module: 'Fixed Assets Management',
    ops: ['list', 'get'],
  },
  {
    value: 'fixed-assets/setup',
    label: 'Setup',
    module: 'Fixed Assets Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'fixed-assets/setup-posting-rule',
    label: 'Setup Posting Rule',
    module: 'Fixed Assets Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'fixed-assets/transfer-history',
    label: 'Transfer History',
    module: 'Fixed Assets Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'fixed-assets/transfer-journal-entry-map',
    label: 'Transfer Journal Entry Map',
    module: 'Fixed Assets Management',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/account',
    label: 'Account',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/account-allocation',
    label: 'Account Allocation',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/account-allocation-basis',
    label: 'Account Allocation Basis',
    module: 'General Ledger',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'general-ledger/account-allocation-group',
    label: 'Account Allocation Group',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/account-allocation-group-member',
    label: 'Account Allocation Group Member',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/account-allocation-reverse',
    label: 'Account Allocation Reverse',
    module: 'General Ledger',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'general-ledger/account-allocation-run',
    label: 'Account Allocation Run',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'delete'],
  },
  {
    value: 'general-ledger/account-allocation-source',
    label: 'Account Allocation Source',
    module: 'General Ledger',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'general-ledger/account-allocation-target',
    label: 'Account Allocation Target',
    module: 'General Ledger',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'general-ledger/account-category',
    label: 'Account Category',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/account-group',
    label: 'Account Group',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/account-group-category-member',
    label: 'Account Group Category Member',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/account-group-computation',
    label: 'Account Group Computation',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/account-group-member',
    label: 'Account Group Member',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/account-group-purpose',
    label: 'Account Group Purpose',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/account-range',
    label: 'Account Range',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/budget',
    label: 'Budget',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/budget-detail',
    label: 'Budget Detail',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/journal',
    label: 'Journal',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/journal-entry',
    label: 'Journal Entry',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/journal-entry-line',
    label: 'Journal Entry Line',
    module: 'General Ledger',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'general-ledger/journal-entry-tax-entry',
    label: 'Journal Entry Tax Entry',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/reporting-period',
    label: 'Reporting Period',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/statistical-account',
    label: 'Statistical Account',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/statistical-adjustment-journal',
    label: 'Statistical Adjustment Journal',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/statistical-journal',
    label: 'Statistical Journal',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/statistical-journal-entry',
    label: 'Statistical Journal Entry',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/statistical-journal-entry-line',
    label: 'Statistical Journal Entry Line',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'general-ledger/txn-allocation-template',
    label: 'Txn Allocation Template',
    module: 'General Ledger',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'general-ledger/txn-allocation-template-line',
    label: 'Txn Allocation Template Line',
    module: 'General Ledger',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/aisle',
    label: 'Aisle',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/bin',
    label: 'Bin',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/bin-face',
    label: 'Bin Face',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/bin-size',
    label: 'Bin Size',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/cycle',
    label: 'Cycle',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/document',
    label: 'Document',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/document-history',
    label: 'Document History',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/document-line',
    label: 'Document Line',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/document-line-detail',
    label: 'Document Line Detail',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/document-line-supplies-detail',
    label: 'Document Line Supplies Detail',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/document-line::{documentName}',
    label: 'Document Line::{documentname}',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/document-subtotal',
    label: 'Document Subtotal',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/document::{documentName}',
    label: 'Document::{documentname}',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/item',
    label: 'Item',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/item-cross-reference',
    label: 'Item Cross Reference',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/item-gl-group',
    label: 'Item Gl Group',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/item-group',
    label: 'Item Group',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/item-landed-cost',
    label: 'Item Landed Cost',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'tax/item-tax-group-item-map',
    label: 'Item Tax Group Item Map',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/item-vendor',
    label: 'Item Vendor',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/item-warehouse-inventory',
    label: 'Item Warehouse Inventory',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/item-warehouse-standard-cost',
    label: 'Item Warehouse Standard Cost',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/item-warehouse-vendor',
    label: 'Item Warehouse Vendor',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/kit-component',
    label: 'Kit Component',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/posting-summary',
    label: 'Posting Summary',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/price-list',
    label: 'Price List',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/price-list-entry',
    label: 'Price List Entry',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/product-line',
    label: 'Product Line',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/row',
    label: 'Row',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/stockable-kit-document',
    label: 'Stockable Kit Document',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/stockable-kit-document-line',
    label: 'Stockable Kit Document Line',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/supplies-document',
    label: 'Supplies Document',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/supplies-document-detail',
    label: 'Supplies Document Detail',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/total',
    label: 'Total',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/txn-definition',
    label: 'Txn Definition',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/txn-definition-cogs-gl-detail',
    label: 'Txn Definition Cogs Gl Detail',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/txn-definition-entity-detail',
    label: 'Txn Definition Entity Detail',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/txn-definition-source',
    label: 'Txn Definition Source',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/txn-definition-subtotal-detail',
    label: 'Txn Definition Subtotal Detail',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/txn-definition-total-detail',
    label: 'Txn Definition Total Detail',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/unit-of-measure',
    label: 'Unit Of Measure',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/unit-of-measure-group',
    label: 'Unit Of Measure Group',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/warehouse',
    label: 'Warehouse',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/warehouse-transfer',
    label: 'Warehouse Transfer',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'inventory-control/warehouse-transfer-line',
    label: 'Warehouse Transfer Line',
    module: 'Inventory Control',
    ops: ['list', 'get'],
  },
  {
    value: 'inventory-control/zone',
    label: 'Zone',
    module: 'Inventory Control',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/customer-gl-group',
    label: 'Customer Gl Group',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/document',
    label: 'Document',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/document-history',
    label: 'Document History',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/document-line',
    label: 'Document Line',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/document-line-detail',
    label: 'Document Line Detail',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/document-line-subtotal',
    label: 'Document Line Subtotal',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/document-line::{documentName}',
    label: 'Document Line::{documentname}',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/document-subtotal',
    label: 'Document Subtotal',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/document::{documentName}',
    label: 'Document::{documentname}',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/price-list',
    label: 'Price List',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/price-list-entry',
    label: 'Price List Entry',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/price-schedule',
    label: 'Price Schedule',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/recurring-document',
    label: 'Recurring Document',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/recurring-document-line',
    label: 'Recurring Document Line',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'delete'],
  },
  {
    value: 'order-entry/recurring-document-subtotal',
    label: 'Recurring Document Subtotal',
    module: 'Order Entry',
    ops: ['list', 'get'],
  },
  {
    value: 'order-entry/recurring-document::{documentName}',
    label: 'Recurring Document::{documentname}',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/recurring-schedule',
    label: 'Recurring Schedule',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/renewal-template',
    label: 'Renewal Template',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/subtotal-template',
    label: 'Subtotal Template',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/subtotal-template-line',
    label: 'Subtotal Template Line',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition',
    label: 'Txn Definition',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition-additional-gl-detail',
    label: 'Txn Definition Additional Gl Detail',
    module: 'Order Entry',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition-ar-direct-gl-detail',
    label: 'Txn Definition Ar Direct Gl Detail',
    module: 'Order Entry',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition-cogs-gl-detail',
    label: 'Txn Definition Cogs Gl Detail',
    module: 'Order Entry',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition-entity-setting-detail',
    label: 'Txn Definition Entity Setting Detail',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition-inventory-total-detail',
    label: 'Txn Definition Inventory Total Detail',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition-source-document-detail',
    label: 'Txn Definition Source Document Detail',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'order-entry/txn-definition-subtotal-detail',
    label: 'Txn Definition Subtotal Detail',
    module: 'Order Entry',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/cost-type',
    label: 'Cost Type',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/invoice-run',
    label: 'Invoice Run',
    module: 'Project and Resource Management',
    ops: ['list', 'get'],
  },
  {
    value: 'projects/position-skill',
    label: 'Position Skill',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/project',
    label: 'Project',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/project-billing-template',
    label: 'Project Billing Template',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/project-billing-template-milestone',
    label: 'Project Billing Template Milestone',
    module: 'Project and Resource Management',
    ops: ['list', 'get'],
  },
  {
    value: 'projects/project-group',
    label: 'Project Group',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/project-resource',
    label: 'Project Resource',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/project-status',
    label: 'Project Status',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/project-type',
    label: 'Project Type',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/standard-cost-type',
    label: 'Standard Cost Type',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'construction/standard-task',
    label: 'Standard Task',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/task',
    label: 'Task',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'projects/task-group',
    label: 'Task Group',
    module: 'Project and Resource Management',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/document',
    label: 'Document',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/document-configuration-preference',
    label: 'Document Configuration Preference',
    module: 'Purchasing',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'purchasing/document-history',
    label: 'Document History',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/document-line',
    label: 'Document Line',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/document-line-detail',
    label: 'Document Line Detail',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/document-line-subtotal',
    label: 'Document Line Subtotal',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/document-line::{documentName}',
    label: 'Document Line::{documentname}',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/document-subtotal',
    label: 'Document Subtotal',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/document::{documentName}',
    label: 'Document::{documentname}',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/price-list',
    label: 'Price List',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/price-list-entry',
    label: 'Price List Entry',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/price-schedule',
    label: 'Price Schedule',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/recurring-document',
    label: 'Recurring Document',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/recurring-document-line',
    label: 'Recurring Document Line',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'delete'],
  },
  {
    value: 'purchasing/recurring-document-subtotal',
    label: 'Recurring Document Subtotal',
    module: 'Purchasing',
    ops: ['list', 'get'],
  },
  {
    value: 'purchasing/recurring-document::{documentName}',
    label: 'Recurring Document::{documentname}',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/secondary-vendor',
    label: 'Secondary Vendor',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/subtotal-template',
    label: 'Subtotal Template',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/subtotal-template-line',
    label: 'Subtotal Template Line',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-automation-preference',
    label: 'Txn Automation Preference',
    module: 'Purchasing',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'purchasing/txn-automation-without-match-preference',
    label: 'Txn Automation Without Match Preference',
    module: 'Purchasing',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'purchasing/txn-definition',
    label: 'Txn Definition',
    module: 'Purchasing',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-definition-additional-gl-detail',
    label: 'Txn Definition Additional Gl Detail',
    module: 'Purchasing',
    ops: ['list', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-definition-ap-direct-gl-detail',
    label: 'Txn Definition Ap Direct Gl Detail',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-definition-entity-setting-detail',
    label: 'Txn Definition Entity Setting Detail',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-definition-inventory-total-detail',
    label: 'Txn Definition Inventory Total Detail',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-definition-source-document-detail',
    label: 'Txn Definition Source Document Detail',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-definition-subtotal-detail',
    label: 'Txn Definition Subtotal Detail',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'purchasing/txn-match-tolerance-preference',
    label: 'Txn Match Tolerance Preference',
    module: 'Purchasing',
    ops: ['list', 'get', 'update'],
  },
  {
    value: 'purchasing/vendor-gl-group',
    label: 'Vendor Gl Group',
    module: 'Purchasing',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'reports/interactive-custom-report',
    label: 'Interactive Custom Report',
    module: 'Reports',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'reports/stored-report',
    label: 'Stored Report',
    module: 'Reports',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'reports/stored-report-error-record',
    label: 'Stored Report Error Record',
    module: 'Reports',
    ops: ['list', 'get'],
  },
  {
    value: 'tax/account-label-tax-group',
    label: 'Account Label Tax Group',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/contact-tax-group',
    label: 'Contact Tax Group',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/item-tax-group',
    label: 'Item Tax Group',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/order-entry-tax-detail',
    label: 'Order Entry Tax Detail',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/order-entry-tax-schedule',
    label: 'Order Entry Tax Schedule',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/order-entry-tax-schedule-detail',
    label: 'Order Entry Tax Schedule Detail',
    module: 'Tax',
    ops: ['list', 'get'],
  },
  {
    value: 'tax/purchasing-tax-detail',
    label: 'Purchasing Tax Detail',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/purchasing-tax-schedule',
    label: 'Purchasing Tax Schedule',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/purchasing-tax-schedule-detail',
    label: 'Purchasing Tax Schedule Detail',
    module: 'Tax',
    ops: ['list', 'get'],
  },
  {
    value: 'tax/tax-authority',
    label: 'Tax Authority',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/tax-detail',
    label: 'Tax Detail',
    module: 'Tax',
    ops: ['list', 'get'],
  },
  {
    value: 'tax/tax-record',
    label: 'Tax Record',
    module: 'Tax',
    ops: ['list', 'get'],
  },
  {
    value: 'tax/tax-return',
    label: 'Tax Return',
    module: 'Tax',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'tax/tax-solution',
    label: 'Tax Solution',
    module: 'Tax',
    ops: ['list', 'get', 'delete'],
  },
  {
    value: 'time/time-type',
    label: 'Time Type',
    module: 'Time',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'time/timesheet',
    label: 'Timesheet',
    module: 'Time',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'time/timesheet-approval-record',
    label: 'Timesheet Approval Record',
    module: 'Time',
    ops: ['list', 'get'],
  },
  {
    value: 'time/timesheet-line',
    label: 'Timesheet Line',
    module: 'Time',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'time/timesheet-rule',
    label: 'Timesheet Rule',
    module: 'Time',
    ops: ['list', 'create', 'get', 'update', 'delete'],
  },
  {
    value: 'time/timesheet-to-approve',
    label: 'Timesheet To Approve',
    module: 'Time',
    ops: ['list', 'get'],
  },
]

/**
 * @requireOAuth
 * @integrationName Sage Intacct
 * @integrationIcon /icon.png
 */
class SageIntacct {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  // ==================== Private Helpers ====================

  #getAccessToken() {
    const token = this.request.headers['oauth-access-token']

    if (!token) {
      throw new Error(
        'Access token is not available. Please reconnect your Sage Intacct account.'
      )
    }

    return token
  }

  #getAccessTokenHeader() {
    return { Authorization: `Bearer ${ this.#getAccessToken() }` }
  }

  #getSecretTokenHeader() {
    const credentials = Buffer.from(
      `${ this.clientId }:${ this.clientSecret }`
    ).toString('base64')

    return { Authorization: `Basic ${ credentials }` }
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query || {})

    logger.debug(
      `${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`
    )

    try {
      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ Accept: 'application/json' })

      if (Object.keys(query).length > 0) {
        request.query(query)
      }

      if (body) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const errorBody = error?.body

      if (errorBody?.['ia::error']) {
        const iaError = errorBody['ia::error']
        const errorMessages = []

        if (iaError.message) {
          errorMessages.push(iaError.message)
        }

        if (Array.isArray(iaError.details)) {
          iaError.details.forEach(detail => {
            if (detail.message) {
              errorMessages.push(detail.message)
            }

            if (detail.correction) {
              errorMessages.push(`Suggestion: ${ detail.correction }`)
            }
          })
        }

        if (errorMessages.length > 0) {
          const fullMessage = errorMessages.join('; ')

          logger.error(`${ logTag } - Sage Intacct error: ${ fullMessage }`)

          throw new Error(fullMessage)
        }
      }

      logger.error(
        `${ logTag } - api error:`,
        typeof error === 'object' ? JSON.stringify(error) : error
      )

      throw error
    }
  }

  // Turns a field key (camelCase or snake_case) into a human-readable label,
  // e.g. 'glAccount' -> 'Gl Account', 'account_label' -> 'Account Label'.
  #humanizeFieldName(name) {
    // Known acronyms that should stay fully uppercase in labels.
    const acronyms = new Set([
      'id', 'gl', 'url', 'ap', 'ar', 'po', 'oe', 'ic', 'cip', 'wip', 'ach',
      'kpi', 'mrr', 'mea', 'ssn', 'ein', 'vat', 'gst', 'hst', 'pst', 'qst',
      'eft', 'api', 'ui', 'pto', 'ytd', 'mtd', 'uom', 'sku', 'asn',
    ])

    const words = String(name)
      // split camelCase boundaries: 'glAccount' -> 'gl Account'
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // split an acronym run from a following word: 'GLAccount' -> 'GL Account'
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)

    return words
      .map(word => {
        if (acronyms.has(word.toLowerCase())) {
          return word.toUpperCase()
        }

        // Preserve words that are already all-caps/digits, e.g. 'SSN', 'URL1'.
        if (/^[A-Z0-9]+$/.test(word)) {
          return word
        }

        return word.charAt(0).toUpperCase() + word.slice(1)
      })
      .join(' ')
  }

  // Maps a single model field descriptor to a FlowRunner field-schema object.
  #mapModelFieldToSchema(name, field) {
    const typeMap = {
      string: 'String',
      boolean: 'Boolean',
      number: 'Number',
      integer: 'Number',
    }

    const schemaField = {
      type: typeMap[field.type] || 'String',
      label: this.#humanizeFieldName(name),
      name,
      required: field.required === true,
    }

    if (field.description) {
      schemaField.description = field.description
    }

    if (Array.isArray(field.enum) && field.enum.length > 0) {
      schemaField.uiComponent = {
        type: 'DROPDOWN',
        options: { values: field.enum },
      }
    } else if (field.type === 'boolean') {
      schemaField.uiComponent = { type: 'TOGGLE' }
    } else if (field.type === 'number' || field.type === 'integer') {
      schemaField.uiComponent = { type: 'NUMERIC' }
    } else if (field.type === 'string' && field.format === 'date') {
      schemaField.uiComponent = { type: 'DATE_PICKER' }
    } else if (field.type === 'string' && field.format === 'date-time') {
      schemaField.uiComponent = { type: 'DATE_TIME_PICKER' }
    }

    return schemaField
  }

  // Fetches the field schema for an object type from the Sage Intacct model
  // endpoint and maps it into FlowRunner field-schema objects. Writable fields
  // and relationship references are included; read-only fields, system field
  // groups, and owned-object lists are excluded. Returns null when the schema
  // cannot be loaded, so callers can fall back to the raw-JSON field.
  async #loadObjectFieldSchema(objectType) {
    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/services/core/model`,
        method: 'get',
        query: { name: objectType, schema: 'true', description: 'true' },
        logTag: 'loadObjectFieldSchema',
      })

      const result = response?.['ia::result']

      if (!result) {
        return null
      }

      const schema = []
      const fields = result.fields || {}

      for (const [name, field] of Object.entries(fields)) {
        if (!field || field.readOnly === true) {
          continue
        }

        schema.push(this.#mapModelFieldToSchema(name, field))
      }

      const refs = result.refs || {}

      for (const [refName, ref] of Object.entries(refs)) {
        if (!ref) {
          continue
        }

        schema.push({
          type: 'String',
          label: this.#humanizeFieldName(refName),
          name: refName,
          description: `Enter the ID of the ${ refName }.`,
        })
      }

      return schema.length > 0 ? schema : null
    } catch (error) {
      logger.warn(
        `loadObjectFieldSchema - failed to load schema for ${ objectType }: ${ error?.message || error }`
      )

      return null
    }
  }

  // Builds a request body for the Query service (POST /services/core/query).
  // The Query service is how Sage Intacct filters, orders, selects fields, and
  // paginates - a plain GET on a collection does not accept those options.
  #buildQueryBody({ objectType, fields, filter, orderBy, limit, offset }) {
    const body = { object: objectType }

    if (fields) {
      const fieldList = fields
        .split(',')
        .map(f => f.trim())
        .filter(Boolean)

      if (fieldList.length > 0) {
        body.fields = fieldList
      }
    }

    if (filter) {
      const parsed = this.#parseFilter(filter)

      if (parsed) {
        body.filters = parsed
      }
    }

    if (orderBy) {
      const parsedOrder = this.#parseOrderBy(orderBy)

      if (parsedOrder.length > 0) {
        body.orderBy = parsedOrder
      }
    }

    body.size = limit || DEFAULT_LIMIT
    body.start = offset || 1

    return body
  }

  // Accepts the Query service filter form as JSON - an array of operator
  // objects (e.g. [{"$eq":{"status":"active"}}]) or a single such object.
  #parseFilter(filter) {
    if (Array.isArray(filter)) {
      return filter
    }

    if (typeof filter === 'object') {
      return [filter]
    }

    try {
      const parsed = JSON.parse(filter)

      return Array.isArray(parsed) ? parsed : [parsed]
    } catch (e) {
      throw new Error(
        'Invalid Filter. Provide a JSON array of conditions, for example: ' +
          '[{"$eq":{"status":"active"}},{"$contains":{"name":"Acme"}}].'
      )
    }
  }

  // Accepts a "fieldName asc"/"fieldName desc" shorthand or a JSON array of
  // {field: direction} objects, and returns the Query service orderBy array.
  #parseOrderBy(orderBy) {
    if (Array.isArray(orderBy)) {
      return orderBy
    }

    const trimmed = String(orderBy).trim()

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)

        return Array.isArray(parsed) ? parsed : [parsed]
      } catch (e) {
        // fall through to shorthand parsing
      }
    }

    const parts = trimmed.split(/\s+/)
    const field = parts[0]
    const direction = (parts[1] || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'

    return field ? [{ [field]: direction }] : []
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==================== OAuth2 System Methods ====================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', DEFAULT_SCOPE)
    params.append('response_type', 'code')

    return `${ OAUTH_AUTH_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {Object}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let connectionIdentityName = 'Sage Intacct Account'

    try {
      const companyInfo = await Flowrunner.Request.get(
        `${ API_BASE_URL }/objects/company-config/preferences/company`
      )
        .set({ Authorization: `Bearer ${ tokenResponse.access_token }` })
        .set({ Accept: 'application/json' })

      const company = companyInfo?.['ia::result']

      if (company?.name) {
        connectionIdentityName = company.name
      }
    } catch (e) {
      logger.warn('executeCallback - could not fetch company info:', e.message)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: null,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {Object}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error('refreshToken - error:', error.message || error)

      if (error?.body?.error === 'invalid_grant') {
        throw new Error(
          'Refresh token expired or invalid, please re-authenticate.'
        )
      }

      throw error
    }
  }

  // ==================== Universal CRUD Methods ====================

  /**
   * @operationName Create Record
   * @category Records
   * @description Creates a new record of any supported type in Sage Intacct. Select the object type first, then fill in the dynamically generated fields. Supports 400+ object types across all Sage Intacct modules.
   *
   * @route POST /create-record
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"dictionary":"getObjectTypesDictionary","description":"The type of record to create (e.g., Customer, Vendor, Invoice, Bill)."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"dependsOn":["objectType"],"schemaLoader":"createRecordFieldsSchemaLoader","description":"Fields for the new record. Available fields are generated dynamically based on the selected object type."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"CUST-001","href":"/objects/accounts-receivable/customer/123"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async createRecord(objectType, fields) {
    if (!objectType) {
      throw new Error('"Object Type" is required.')
    }

    let body = fields || {}

    if (body.__rawJson) {
      try {
        body = JSON.parse(body.__rawJson)
      } catch (e) {
        throw new Error('Invalid JSON in Record Data field.')
      }
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/objects/${ objectType }`,
      method: 'post',
      body,
      logTag: 'createRecord',
    })
  }

  /**
   * @operationName Get Record
   * @category Records
   * @description Retrieves a single record by key from Sage Intacct. Returns the full record details for the selected object type.
   *
   * @route POST /get-record
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"dictionary":"getObjectTypesDictionary","description":"The type of record to retrieve."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectType"],"description":"The record to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"CUST-001","name":"Acme Corporation","status":"active","href":"/objects/accounts-receivable/customer/123"},"ia::meta":{"totalCount":1}}
   */
  async getRecord(objectType, recordId) {
    if (!objectType) throw new Error('"Object Type" is required.')
    if (!recordId) throw new Error('"Record" is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/objects/${ objectType }/${ recordId }`,
      logTag: 'getRecord',
    })
  }

  /**
   * @operationName Update Record
   * @category Records
   * @description Updates an existing record in Sage Intacct. Only the fields you provide will be changed; all other fields remain unchanged.
   *
   * @route POST /update-record
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"dictionary":"getObjectTypesDictionary","description":"The type of record to update."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectType"],"description":"The record to update."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"dependsOn":["objectType"],"schemaLoader":"updateRecordFieldsSchemaLoader","description":"Fields to update. Available fields are generated dynamically based on the selected object type."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"CUST-001","href":"/objects/accounts-receivable/customer/123"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async updateRecord(objectType, recordId, fields) {
    if (!objectType) throw new Error('"Object Type" is required.')
    if (!recordId) throw new Error('"Record" is required.')

    let body = fields || {}

    if (body.__rawJson) {
      try {
        body = JSON.parse(body.__rawJson)
      } catch (e) {
        throw new Error('Invalid JSON in Record Data field.')
      }
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/objects/${ objectType }/${ recordId }`,
      method: 'patch',
      body: cleanupObject(body),
      logTag: 'updateRecord',
    })
  }

  /**
   * @operationName Delete Record
   * @category Records
   * @description Deletes a record from Sage Intacct. This action cannot be undone. Some record types may not support deletion if they have dependent records.
   *
   * @route POST /delete-record
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"dictionary":"getObjectTypesDictionary","description":"The type of record to delete."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectType"],"description":"The record to delete."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"ia::status":"deleted"}}
   */
  async deleteRecord(objectType, recordId) {
    if (!objectType) throw new Error('"Object Type" is required.')
    if (!recordId) throw new Error('"Record" is required.')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/objects/${ objectType }/${ recordId }`,
      method: 'delete',
      logTag: 'deleteRecord',
    })
  }

  // ==================== Utility Methods ====================

  /**
   * @operationName List Records
   * @category Records
   * @description Queries and lists records of any supported type in Sage Intacct. Supports filtering, field selection, ordering, and pagination.
   *
   * @route POST /list-records
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"dictionary":"getObjectTypesDictionary","description":"The type of records to list."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated list of field names to include in results. Leave empty to return the default fields."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Conditions to narrow results, as a JSON array. Example: [{\"$eq\":{\"status\":\"active\"}},{\"$contains\":{\"name\":\"Acme\"}}]. Conditions are combined with AND. Operators include $eq, $ne, $gt, $lt, $gte, $lte, $contains, $in."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"Field name to sort by, optionally followed by 'asc' or 'desc'. Example: 'name asc'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return. Defaults to 100, up to 4000."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Position of the first record to return, starting at 1. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":[{"key":"123","id":"CUST-001","name":"Acme Corp","href":"/objects/accounts-receivable/customer/123"}],"ia::meta":{"totalCount":1,"start":1,"pageSize":100,"next":null,"previous":null}}
   */
  async listRecords(objectType, fields, filter, orderBy, limit, offset) {
    if (!objectType) throw new Error('"Object Type" is required.')

    const body = this.#buildQueryBody({
      objectType,
      fields,
      filter,
      orderBy,
      limit,
      offset,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/services/core/query`,
      method: 'post',
      body,
      logTag: 'listRecords',
    })
  }

  // ==================== Workflow Action Methods ====================

  /**
   * @operationName Approve a vendor
   * @category Accounts Payable
   * @description Approve a vendor.
   *
   * @route POST /accounts-payable-vendor-approve
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the vendor."}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Notes or comments about this vendor."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"V-00014","href":"/objects/accounts-payable/vendor/123","state":"approved"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async approveVendor(key, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-payable/vendor/approve`,
      method: 'post',
      body: { key: key, notes: notes },
      logTag: 'approveVendor',
    })
  }

  /**
   * @operationName Decline a vendor
   * @category Accounts Payable
   * @description Decline a vendor.
   *
   * @route POST /accounts-payable-vendor-decline
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the vendor."}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Notes or comments about this vendor."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"V-00014","href":"/objects/accounts-payable/vendor/123","state":"declined"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async declineVendor(key, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-payable/vendor/decline`,
      method: 'post',
      body: { key: key, notes: notes },
      logTag: 'declineVendor',
    })
  }

  /**
   * @operationName Reclassify an adjustment
   * @category Accounts Receivable
   * @description Reclassify an adjustment.
   *
   * @route POST /accounts-receivable-adjustment-reclassify
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the adjustment.", "required": true}
   * @paramDef {"type": "String", "label": "ID", "name": "id", "description": "Unique ID for the adjustment."}
   * @paramDef {"type": "String", "label": "Adjustment Number", "name": "adjustmentNumber", "description": "Unique adjustment number specified when creating an adjustment or auto-generated when document sequencing is configured."}
   * @paramDef {"type": "String", "label": "Document Number", "name": "documentNumber", "description": "Invoice number specified as a reference for the adjustment."}
   * @paramDef {"type": "String", "label": "Description", "name": "description", "description": "Description of the adjustment."}
   * @paramDef {"type": "String", "label": "Attachment", "name": "attachment", "description": "Supporting document for the adjustment."}
   * @paramDef {"type": "String", "label": "Href", "name": "href", "description": "URL endpoint for the adjustment."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"ADJ-0001","href":"/objects/accounts-receivable/adjustment/123","state":"posted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reclassifyAdjustment(
    key,
    id,
    adjustmentNumber,
    documentNumber,
    description,
    attachment,
    href
  ) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/adjustment/reclassify`,
      method: 'post',
      body: {
        key: key,
        id: id,
        adjustmentNumber: adjustmentNumber,
        documentNumber: documentNumber,
        description: description,
        attachment: attachment,
        href: href,
      },
      logTag: 'reclassifyAdjustment',
    })
  }

  /**
   * @operationName Reverse an adjustment
   * @category Accounts Receivable
   * @description Reverse an adjustment.
   *
   * @route POST /accounts-receivable-adjustment-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the adjustment.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date the transaction is reversed.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Notes or comments about the reason for the the adjustment reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"ADJ-0001","href":"/objects/accounts-receivable/adjustment/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseAdjustment(key, reversedDate, memo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/adjustment/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, memo: memo },
      logTag: 'reverseAdjustment',
    })
  }

  /**
   * @operationName Submit an adjustment
   * @category Accounts Receivable
   * @description Submit an adjustment.
   *
   * @route POST /accounts-receivable-adjustment-submit
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the adjustment.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"ADJ-0001","href":"/objects/accounts-receivable/adjustment/123","state":"submitted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async submitAdjustment(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/adjustment/submit`,
      method: 'post',
      body: { key: key },
      logTag: 'submitAdjustment',
    })
  }

  /**
   * @operationName Reverse an advance
   * @category Accounts Receivable
   * @description Reverse an advance.
   *
   * @route POST /accounts-receivable-advance-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the advance.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date the transaction is reversed.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Notes or comments about the reason for the the advance reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"ADV-0001","href":"/objects/accounts-receivable/advance/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseAdvance(key, reversedDate, memo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/advance/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, memo: memo },
      logTag: 'reverseAdvance',
    })
  }

  /**
   * @operationName Submit an advance
   * @category Accounts Receivable
   * @description Submit an advance.
   *
   * @route POST /accounts-receivable-advance-submit
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the advance.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"ADV-0001","href":"/objects/accounts-receivable/advance/123","state":"submitted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async submitAdvance(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/advance/submit`,
      method: 'post',
      body: { key: key },
      logTag: 'submitAdvance',
    })
  }

  /**
   * @operationName Reverse a customer refund
   * @category Accounts Receivable
   * @description Reverse a customer refund.
   *
   * @route POST /accounts-receivable-customer-refund-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for customer refund.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date the transactions is reversed.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Description", "name": "description", "description": "Notes or comments about the reason for the the refund reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"REF-01","href":"/objects/accounts-receivable/customer-refund/123","state":"voided"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseCustomerRefund(key, reversedDate, description) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/customer-refund/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, description: description },
      logTag: 'reverseCustomerRefund',
    })
  }

  /**
   * @operationName Submit a customer refund
   * @category Accounts Receivable
   * @description Submit a customer refund.
   *
   * @route POST /accounts-receivable-customer-refund-submit
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the customer refund.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"REF-02","href":"/objects/accounts-receivable/customer-refund/123","state":"posted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async submitCustomerRefund(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/customer-refund/submit`,
      method: 'post',
      body: { key: key },
      logTag: 'submitCustomerRefund',
    })
  }

  /**
   * @operationName Generate a PDF of an invoice
   * @category Accounts Receivable
   * @description Generate a PDF of an invoice.
   *
   * @route POST /accounts-receivable-invoice-generate-pdf
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the invoice.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"INV-0001","href":"/objects/accounts-receivable/invoice/123","state":"posted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async generatePdfInvoice(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/invoice/generate-pdf`,
      method: 'post',
      body: { key: key },
      logTag: 'generatePdfInvoice',
    })
  }

  /**
   * @operationName Reclassify an invoice
   * @category Accounts Receivable
   * @description Reclassify an invoice.
   *
   * @route POST /accounts-receivable-invoice-reclassify
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the invoice.", "required": true}
   * @paramDef {"type": "String", "label": "ID", "name": "id", "description": "Unique ID for the invoice."}
   * @paramDef {"type": "String", "label": "Invoice Number", "name": "invoiceNumber", "description": "Unique invoice number specified when creating an invoice or auto-generated when document sequencing is configured."}
   * @paramDef {"type": "String", "label": "Reference Number", "name": "referenceNumber", "description": "Customer purchase order number or another reference number."}
   * @paramDef {"type": "String", "label": "Description", "name": "description", "description": "Description of the invoice, which prints on the Customer Ledger report."}
   * @paramDef {"type": "String", "label": "Term", "name": "term", "description": "Term details for the invoice."}
   * @paramDef {"type": "String", "label": "Due Date", "name": "dueDate", "description": "Date the invoice is due.", "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Attachment", "name": "attachment", "description": "Supporting document attached to the invoice."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"INV-0001","href":"/objects/accounts-receivable/invoice/123","state":"posted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reclassifyInvoice(
    key,
    id,
    invoiceNumber,
    referenceNumber,
    description,
    term,
    dueDate,
    attachment
  ) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/invoice/reclassify`,
      method: 'post',
      body: {
        key: key,
        id: id,
        invoiceNumber: invoiceNumber,
        referenceNumber: referenceNumber,
        description: description,
        term: term,
        dueDate: dueDate,
        attachment: attachment,
      },
      logTag: 'reclassifyInvoice',
    })
  }

  /**
   * @operationName Reverse an invoice
   * @category Accounts Receivable
   * @description Reverse an invoice.
   *
   * @route POST /accounts-receivable-invoice-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the invoice.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date the transactions is reversed.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Notes or comments about the reason for the invoice reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"INV-0001","href":"/objects/accounts-receivable/invoice/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseInvoice(key, reversedDate, memo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/invoice/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, memo: memo },
      logTag: 'reverseInvoice',
    })
  }

  /**
   * @operationName Submit an invoice
   * @category Accounts Receivable
   * @description Submit an invoice.
   *
   * @route POST /accounts-receivable-invoice-submit
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the invoice.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"INV-0001","href":"/objects/accounts-receivable/invoice/123","state":"submitted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async submitInvoice(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/invoice/submit`,
      method: 'post',
      body: { key: key },
      logTag: 'submitInvoice',
    })
  }

  /**
   * @operationName Reverse a payment
   * @category Accounts Receivable
   * @description Reverse a payment.
   *
   * @route POST /accounts-receivable-payment-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the payment.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date the transaction is reversed.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Notes or comments about the reason for the payment reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"PYMT-0001","href":"/objects/accounts-receivable/payment/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reversePayment(key, reversedDate, memo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/payment/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, memo: memo },
      logTag: 'reversePayment',
    })
  }

  /**
   * @operationName Submit an AR payment
   * @category Accounts Receivable
   * @description Submit an AR payment.
   *
   * @route POST /accounts-receivable-payment-submit
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the payment.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"PYMT-0001","href":"/objects/accounts-receivable/payment/123","state":"submitted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async submitPayment(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/accounts-receivable/payment/submit`,
      method: 'post',
      body: { key: key },
      logTag: 'submitPayment',
    })
  }

  /**
   * @operationName Reverse a bank fee
   * @category Cash Management
   * @description Reverse a bank fee.
   *
   * @route POST /cash-management-bank-fee-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the bank fee.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date of the bank fee reversal.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Provides notes or comments about the bank fee reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"BF-0001","href":"/objects/cash-management/bank-fee/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseBankFee(key, reversedDate, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/bank-fee/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, notes: notes },
      logTag: 'reverseBankFee',
    })
  }

  /**
   * @operationName Reopen a bank reconciliation
   * @category Cash Management
   * @description Reopen a bank reconciliation.
   *
   * @route POST /cash-management-bank-reconciliation-reopen
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the bank reconciliation.", "required": true}
   * @paramDef {"type": "String", "label": "Bank Account ID", "name": "bankAccountId", "description": "Unique identifier for the bank account in this reconciliation.", "required": true, "dictionary": "getBankAccountsDictionary"}
   * @paramDef {"type": "String", "label": "Reconciliation Date", "name": "reconciliationDate", "description": "Specifies the date of the reconciliation.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"REC-0001","href":"/objects/cash-management/bank-reconciliation/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reopenBankReconciliation(key, bankAccountId, reconciliationDate) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/bank-reconciliation/reopen`,
      method: 'post',
      body: {
        key: key,
        bankAccountId: bankAccountId,
        reconciliationDate: reconciliationDate,
      },
      logTag: 'reopenBankReconciliation',
    })
  }

  /**
   * @operationName Assign customer to a bank transaction
   * @category Cash Management
   * @description Assign customer to a bank transaction.
   *
   * @route POST /cash-management-bank-transaction-assign-customer
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the bank transaction.", "required": true}
   * @paramDef {"type": "String", "label": "Customer ID", "name": "customerId", "description": "Unique identifier for the customer.", "required": true, "dictionary": "getCustomersDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"TXN-0001","href":"/objects/cash-management/bank-transaction/123","state":"matched"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async assignCustomerBankTransaction(key, customerId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/bank-transaction/assign-customer`,
      method: 'post',
      body: { key: key, customerId: customerId },
      logTag: 'assignCustomerBankTransaction',
    })
  }

  /**
   * @operationName Ignore a bank transaction
   * @category Cash Management
   * @description Ignore a bank transaction.
   *
   * @route POST /cash-management-bank-transaction-ignore
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the bank transaction.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"TXN-0001","href":"/objects/cash-management/bank-transaction/123","state":"ignored"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async ignoreBankTransaction(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/bank-transaction/ignore`,
      method: 'post',
      body: { key: key },
      logTag: 'ignoreBankTransaction',
    })
  }

  /**
   * @operationName Stop ignoring a bank transaction
   * @category Cash Management
   * @description Stop ignoring a bank transaction.
   *
   * @route POST /cash-management-bank-transaction-stop-ignoring
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the bank transaction.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"TXN-0001","href":"/objects/cash-management/bank-transaction/123","state":"new"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async stopIgnoringBankTransaction(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/bank-transaction/stop-ignoring`,
      method: 'post',
      body: { key: key },
      logTag: 'stopIgnoringBankTransaction',
    })
  }

  /**
   * @operationName Reverse a credit card fee
   * @category Cash Management
   * @description Reverse a credit card fee.
   *
   * @route POST /cash-management-credit-card-fee-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the credit card fee.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date of the credit card fee reversal.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Provides additional notes or comments about the credit card fee reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"CCF-0001","href":"/objects/cash-management/credit-card-fee/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseCreditCardFee(key, reversedDate, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/credit-card-fee/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, notes: notes },
      logTag: 'reverseCreditCardFee',
    })
  }

  /**
   * @operationName Reopen a credit card reconciliation
   * @category Cash Management
   * @description Reopen a credit card reconciliation.
   *
   * @route POST /cash-management-credit-card-reconciliation-reopen
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the credit card reconciliation.", "required": true}
   * @paramDef {"type": "String", "label": "Credit Card Account ID", "name": "creditCardAccountId", "description": "Unique identifier for the credit card account in this reconciliation.", "required": true, "dictionary": "getCreditCardAccountsDictionary"}
   * @paramDef {"type": "String", "label": "Reconciliation Date", "name": "reconciliationDate", "description": "Specifies the date of the reconciliation.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"REC-0001","href":"/objects/cash-management/credit-card-reconciliation/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reopenCreditCardReconciliation(
    key,
    creditCardAccountId,
    reconciliationDate
  ) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/credit-card-reconciliation/reopen`,
      method: 'post',
      body: {
        key: key,
        creditCardAccountId: creditCardAccountId,
        reconciliationDate: reconciliationDate,
      },
      logTag: 'reopenCreditCardReconciliation',
    })
  }

  /**
   * @operationName Reverse a credit card transaction
   * @category Cash Management
   * @description Reverse a credit card transaction.
   *
   * @route POST /cash-management-credit-card-txn-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the credit card transaction."}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date this transactions is reversed.", "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Notes or comments about the reason for the reverse of credit card transaction."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"CCT-0001","href":"/objects/cash-management/credit-card-txn/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseCreditCardTxn(key, reversedDate, memo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/credit-card-txn/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, memo: memo },
      logTag: 'reverseCreditCardTxn',
    })
  }

  /**
   * @operationName Reverse a deposit
   * @category Cash Management
   * @description Reverse a deposit.
   *
   * @route POST /cash-management-deposit-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the deposit.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date of the deposit reversal.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Provides additional notes or comments about the deposit reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"DEP-0001","href":"/objects/cash-management/deposit/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseDeposit(key, reversedDate, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/deposit/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, notes: notes },
      logTag: 'reverseDeposit',
    })
  }

  /**
   * @operationName Reverse a funds transfer
   * @category Cash Management
   * @description Reverse a funds transfer.
   *
   * @route POST /cash-management-funds-transfer-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the fund transfer."}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date of the fund transfer reversal.", "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Provides additional notes or comments about the funds transfer reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"FT-0001","href":"/objects/cash-management/funds-transfer/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseFundsTransfer(key, reversedDate, memo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/funds-transfer/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, memo: memo },
      logTag: 'reverseFundsTransfer',
    })
  }

  /**
   * @operationName Reverse an other receipt
   * @category Cash Management
   * @description Reverse an other receipt.
   *
   * @route POST /cash-management-other-receipt-reverse
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the other receipt.", "required": true}
   * @paramDef {"type": "String", "label": "Reversed Date", "name": "reversedDate", "description": "Date of the other receipt reversal.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Provides additional notes or comments about the other receipt reversal."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"OR-0001","href":"/objects/cash-management/other-receipt/123","state":"reversed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async reverseOtherReceipt(key, reversedDate, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/cash-management/other-receipt/reverse`,
      method: 'post',
      body: { key: key, reversedDate: reversedDate, notes: notes },
      logTag: 'reverseOtherReceipt',
    })
  }

  /**
   * @operationName Clear all MEA allocations
   * @category Contracts and Revenue Management
   * @description Clear all MEA allocations.
   *
   * @route POST /contracts-contract-clear-all-mea
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async clearAllMeaContract(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/clear-all-mea`,
      method: 'post',
      body: { key: key },
      logTag: 'clearAllMeaContract',
    })
  }

  /**
   * @operationName Clear last active MEA allocation
   * @category Contracts and Revenue Management
   * @description Clear last active MEA allocation.
   *
   * @route POST /contracts-contract-clear-last-active-mea
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async clearLastActiveMeaContract(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/clear-last-active-mea`,
      method: 'post',
      body: { key: key },
      logTag: 'clearLastActiveMeaContract',
    })
  }

  /**
   * @operationName Expire a contract
   * @category Contracts and Revenue Management
   * @description Expire a contract.
   *
   * @route POST /contracts-contract-expire
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"expired"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async expireContract(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/expire`,
      method: 'post',
      body: { key: key },
      logTag: 'expireContract',
    })
  }

  /**
   * @operationName Hold contract schedules
   * @category Contracts and Revenue Management
   * @description Hold contract schedules.
   *
   * @route POST /contracts-contract-hold-schedules
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   * @paramDef {"type": "String", "label": "Contract Line Keys", "name": "contractLineKeys", "description": "Unique keys for the contract lines.", "required": true}
   * @paramDef {"type": "String", "label": "As Of Date", "name": "asOfDate", "description": "Date the contract schedules are placed on hold.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Additional comments or notes related to the held schedules.", "required": true}
   * @paramDef {"type": "Boolean", "label": "Hold Billing", "name": "holdBilling", "description": "Billing schedule to be held.", "required": true, "uiComponent": {"type": "TOGGLE"}}
   * @paramDef {"type": "Boolean", "label": "Hold Revenue", "name": "holdRevenue", "description": "Revenue schedule to be held.", "required": true, "uiComponent": {"type": "TOGGLE"}}
   * @paramDef {"type": "Boolean", "label": "Hold Expense", "name": "holdExpense", "description": "Expense schedule to hold.", "required": true, "uiComponent": {"type": "TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async holdSchedulesContract(
    key,
    contractLineKeys,
    asOfDate,
    memo,
    holdBilling,
    holdRevenue,
    holdExpense
  ) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/hold-schedules`,
      method: 'post',
      body: {
        key: key,
        contractLineKeys: contractLineKeys,
        asOfDate: asOfDate,
        memo: memo,
        holdBilling: holdBilling,
        holdRevenue: holdRevenue,
        holdExpense: holdExpense,
      },
      logTag: 'holdSchedulesContract',
    })
  }

  /**
   * @operationName Post a contract
   * @category Contracts and Revenue Management
   * @description Post a contract.
   *
   * @route POST /contracts-contract-post
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   * @paramDef {"type": "String", "label": "GL Posting Date", "name": "glPostingDate", "description": "Date when a financial transaction is posted to the General Ledger.", "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Post Memo", "name": "postMemo", "description": "Additional comments or notes related to the post."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async postContract(key, glPostingDate, postMemo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/post`,
      method: 'post',
      body: { key: key, glPostingDate: glPostingDate, postMemo: postMemo },
      logTag: 'postContract',
    })
  }

  /**
   * @operationName Renew a contract
   * @category Contracts and Revenue Management
   * @description Renew a contract.
   *
   * @route POST /contracts-contract-renew
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"renewed"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async renewContract(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/renew`,
      method: 'post',
      body: { key: key },
      logTag: 'renewContract',
    })
  }

  /**
   * @operationName Resume contract schedules
   * @category Contracts and Revenue Management
   * @description Resume contract schedules.
   *
   * @route POST /contracts-contract-resume-schedules
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   * @paramDef {"type": "String", "label": "Contract Line Keys", "name": "contractLineKeys", "description": "Unique keys for the contract lines.", "required": true}
   * @paramDef {"type": "String", "label": "As Of Date", "name": "asOfDate", "description": "Date the contract schedules are resumed.", "required": true, "uiComponent": {"type": "DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Memo", "name": "memo", "description": "Additional comments or notes related to the resumed schedules.", "required": true}
   * @paramDef {"type": "Boolean", "label": "Resume Billing", "name": "resumeBilling", "description": "Billing schedule to resume.", "required": true, "uiComponent": {"type": "TOGGLE"}}
   * @paramDef {"type": "Boolean", "label": "Resume Revenue", "name": "resumeRevenue", "description": "Revenue schedule to resume.", "required": true, "uiComponent": {"type": "TOGGLE"}}
   * @paramDef {"type": "Boolean", "label": "Resume Expense", "name": "resumeExpense", "description": "Expense schedule to resume.", "required": true, "uiComponent": {"type": "TOGGLE"}}
   * @paramDef {"type": "String", "label": "Revenue Adjustment Type", "name": "revenueAdjustmentType", "description": "Type of revenue adjustment for the contract.", "uiComponent": {"type": "DROPDOWN", "options": {"values": ["Template", "One Time", "Distributed", "Walk Forward"]}}}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async resumeSchedulesContract(
    key,
    contractLineKeys,
    asOfDate,
    memo,
    resumeBilling,
    resumeRevenue,
    resumeExpense,
    revenueAdjustmentType
  ) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/resume-schedules`,
      method: 'post',
      body: {
        key: key,
        contractLineKeys: contractLineKeys,
        asOfDate: asOfDate,
        memo: memo,
        resumeBilling: resumeBilling,
        resumeRevenue: resumeRevenue,
        resumeExpense: resumeExpense,
        revenueAdjustmentType: this.#resolveChoice(revenueAdjustmentType, REVENUE_ADJUSTMENT_TYPE_MAP),
      },
      logTag: 'resumeSchedulesContract',
    })
  }

  /**
   * @operationName Uncancel a contract
   * @category Contracts and Revenue Management
   * @description Uncancel a contract.
   *
   * @route POST /contracts-contract-uncancel
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the contract.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/contract/123","state":"inProgress"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async uncancelContract(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/contract/uncancel`,
      method: 'post',
      body: { key: key },
      logTag: 'uncancelContract',
    })
  }

  /**
   * @operationName Post a revenue schedule line
   * @category Contracts and Revenue Management
   * @description Post a revenue schedule line.
   *
   * @route POST /contracts-revenue-schedule-line-post
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the revenue schedule line.", "required": true}
   * @paramDef {"type": "String", "label": "Actual Posting Date", "name": "actualPostingDate", "description": "Indicates the date revenue from the schedule line was recognized and posted to the General Ledger.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/revenue-schedule-line/123","state":"posted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async postRevenueScheduleLine(key, actualPostingDate) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/revenue-schedule-line/post`,
      method: 'post',
      body: { key: key, actualPostingDate: actualPostingDate },
      logTag: 'postRevenueScheduleLine',
    })
  }

  /**
   * @operationName Unpost a revenue schedule line
   * @category Contracts and Revenue Management
   * @description Unpost a revenue schedule line.
   *
   * @route POST /contracts-revenue-schedule-line-unpost
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned unique key for the revenue schedule line.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","href":"/objects/contracts/revenue-schedule-line/123","state":"open"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async unpostRevenueScheduleLine(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/contracts/revenue-schedule-line/unpost`,
      method: 'post',
      body: { key: key },
      logTag: 'unpostRevenueScheduleLine',
    })
  }

  /**
   * @operationName Approve a purchasing document
   * @category Purchasing
   * @description Approve a purchasing document.
   *
   * @route POST /purchasing-document-approve
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the purchasing document.", "required": true}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Notes or comments about this purchasing document."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"PO-0001","href":"/objects/purchasing/document/123","state":"approved"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async approveDocument(key, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/purchasing/document/approve`,
      method: 'post',
      body: { key: key, notes: notes },
      logTag: 'approveDocument',
    })
  }

  /**
   * @operationName Decline a purchasing document
   * @category Purchasing
   * @description Decline a purchasing document.
   *
   * @route POST /purchasing-document-decline
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the purchasing document.", "required": true}
   * @paramDef {"type": "String", "label": "Notes", "name": "notes", "description": "Notes or comments about this purchasing document."}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"PO-0001","href":"/objects/purchasing/document/123","state":"declined"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async declineDocument(key, notes) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/purchasing/document/decline`,
      method: 'post',
      body: { key: key, notes: notes },
      logTag: 'declineDocument',
    })
  }

  /**
   * @operationName Submit a purchasing document
   * @category Purchasing
   * @description Submit a purchasing document.
   *
   * @route POST /purchasing-document-submit
   * @appearanceColor #00A651 #2BC275
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type": "String", "label": "Key", "name": "key", "description": "System-assigned key for the purchasing document.", "required": true}
   *
   * @returns {Object}
   * @sampleResult {"ia::result":{"key":"123","id":"PO-0001","href":"/objects/purchasing/document/123","state":"submitted"},"ia::meta":{"totalCount":1,"totalSuccess":1,"totalError":0}}
   */
  async submitDocument(key) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workflows/purchasing/document/submit`,
      method: 'post',
      body: { key: key },
      logTag: 'submitDocument',
    })
  }

  // ==================== Schema Loaders ====================

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /create-record-fields-schema-loader
   * @paramDef {"type":"Object","name":"payload","required":true}
   * @returns {Array}
   */
  async createRecordFieldsSchemaLoader({ criteria }) {
    const { objectType } = criteria

    if (!objectType) {
      return []
    }

    const schema = await this.#loadObjectFieldSchema(objectType)

    if (!schema || schema.length === 0) {
      return [
        {
          type: 'String',
          label: 'Record Data (JSON)',
          name: '__rawJson',
          required: true,
          uiComponent: { type: 'MULTI_LINE_TEXT' },
          description:
            'JSON object with field names and values for this record type. See Sage Intacct API documentation for available fields.',
        },
      ]
    }

    return schema
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /update-record-fields-schema-loader
   * @paramDef {"type":"Object","name":"payload","required":true}
   * @returns {Array}
   */
  async updateRecordFieldsSchemaLoader({ criteria }) {
    const { objectType } = criteria

    if (!objectType) {
      return []
    }

    const schema = await this.#loadObjectFieldSchema(objectType)

    if (!schema || schema.length === 0) {
      return [
        {
          type: 'String',
          label: 'Record Data (JSON)',
          name: '__rawJson',
          uiComponent: { type: 'MULTI_LINE_TEXT' },
          description:
            'JSON object with field names and values to update. See Sage Intacct API documentation for available fields.',
        },
      ]
    }

    return schema.map(field => ({
      ...field,
      required: false,
    }))
  }

  // ==================== Dictionary Methods ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Object Types Dictionary
   * @description Provides a searchable list of Sage Intacct object types for selection in FlowRunner.
   * @route POST /get-object-types-dictionary
   *
   * @paramDef {"type":"getObjectTypesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering object types."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Customer","value":"accounts-receivable/customer","note":"Accounts Receivable"}],"cursor":null}
   */
  async getObjectTypesDictionary(payload) {
    const { search, cursor } = payload || {}

    let filteredTypes = OBJECT_TYPES

    if (search) {
      const searchLower = search.toLowerCase()

      filteredTypes = OBJECT_TYPES.filter(
        t =>
          t.label.toLowerCase().includes(searchLower) ||
          t.module.toLowerCase().includes(searchLower)
      )
    }

    const currentOffset = cursor ? parseInt(cursor) : 0
    const page = filteredTypes.slice(
      currentOffset,
      currentOffset + DEFAULT_LIMIT
    )
    const hasMore = currentOffset + DEFAULT_LIMIT < filteredTypes.length

    return {
      items: page.map(t => ({
        label: t.label,
        value: t.value,
        note: t.module,
      })),
      cursor: hasMore ? String(currentOffset + DEFAULT_LIMIT) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Records Dictionary
   * @description Provides a searchable list of records for the selected object type in Sage Intacct.
   * @route POST /get-records-dictionary
   *
   * @paramDef {"type":"getRecordsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the selected object type."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp (CUST-001)","value":"123","note":"active"}],"cursor":null}
   */
  async getRecordsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const objectType = criteria?.objectType

    if (!objectType) {
      return { items: [], cursor: null }
    }

    const start = cursor ? parseInt(cursor) : 1

    const body = {
      object: objectType,
      fields: ['key', 'id', 'name', 'status'],
      size: DEFAULT_LIMIT,
      start,
    }

    if (search) {
      body.filters = [
        { $contains: { id: search } },
        { $contains: { name: search } },
      ]

      body.filterExpression = 'or'
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/services/core/query`,
      method: 'post',
      body,
      logTag: 'getRecordsDictionary',
    })

    const items = response?.['ia::result'] || []
    const meta = response?.['ia::meta'] || {}
    const hasMore = start + DEFAULT_LIMIT <= (meta.totalCount || 0)

    return {
      items: items.map(record => ({
        label: record.name || record.id || `Record ${ record.key }`,
        value: String(record.key),
        note: record.status || record.id || `Key: ${ record.key }`,
      })),
      cursor: hasMore ? String(start + DEFAULT_LIMIT) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bank Accounts Dictionary
   * @description Provides a searchable list of checking (bank) accounts for selection in FlowRunner.
   * @route POST /get-bank-accounts-dictionary
   *
   * @paramDef {"type":"getBankAccountsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering bank accounts."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"BOA-CHK","value":"BOA-CHK","note":"active"}],"cursor":null}
   */
  async getBankAccountsDictionary(payload) {
    const { search, cursor } = payload || {}
    const start = cursor ? parseInt(cursor) : 1

    const body = {
      object: 'cash-management/checking-account',
      fields: ['key', 'id', 'status'],
      size: DEFAULT_LIMIT,
      start,
    }

    if (search) {
      body.filters = [{ $contains: { id: search } }]
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/services/core/query`,
      method: 'post',
      body,
      logTag: 'getBankAccountsDictionary',
    })

    const items = response?.['ia::result'] || []
    const meta = response?.['ia::meta'] || {}
    const hasMore = start + DEFAULT_LIMIT <= (meta.totalCount || 0)

    return {
      items: items.map(record => ({
        label: record.id || `Account ${ record.key }`,
        value: String(record.id),
        note: record.status || `Key: ${ record.key }`,
      })),
      cursor: hasMore ? String(start + DEFAULT_LIMIT) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable list of customers for selection in FlowRunner.
   * @route POST /get-customers-dictionary
   *
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering customers."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp (CUST-001)","value":"CUST-001","note":"active"}],"cursor":null}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}
    const start = cursor ? parseInt(cursor) : 1

    const body = {
      object: 'accounts-receivable/customer',
      fields: ['key', 'id', 'name', 'status'],
      size: DEFAULT_LIMIT,
      start,
    }

    if (search) {
      body.filters = [
        { $contains: { id: search } },
        { $contains: { name: search } },
      ]

      body.filterExpression = 'or'
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/services/core/query`,
      method: 'post',
      body,
      logTag: 'getCustomersDictionary',
    })

    const items = response?.['ia::result'] || []
    const meta = response?.['ia::meta'] || {}
    const hasMore = start + DEFAULT_LIMIT <= (meta.totalCount || 0)

    return {
      items: items.map(record => ({
        label: record.name
          ? `${ record.name } (${ record.id })`
          : record.id || `Customer ${ record.key }`,
        value: String(record.id),
        note: record.status || `Key: ${ record.key }`,
      })),
      cursor: hasMore ? String(start + DEFAULT_LIMIT) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Credit Card Accounts Dictionary
   * @description Provides a searchable list of credit card accounts for selection in FlowRunner.
   * @route POST /get-credit-card-accounts-dictionary
   *
   * @paramDef {"type":"getCreditCardAccountsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering credit card accounts."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"AMEX-CORP","value":"AMEX-CORP","note":"active"}],"cursor":null}
   */
  async getCreditCardAccountsDictionary(payload) {
    const { search, cursor } = payload || {}
    const start = cursor ? parseInt(cursor) : 1

    const body = {
      object: 'cash-management/credit-card-account',
      fields: ['key', 'id', 'status'],
      size: DEFAULT_LIMIT,
      start,
    }

    if (search) {
      body.filters = [{ $contains: { id: search } }]
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/services/core/query`,
      method: 'post',
      body,
      logTag: 'getCreditCardAccountsDictionary',
    })

    const items = response?.['ia::result'] || []
    const meta = response?.['ia::meta'] || {}
    const hasMore = start + DEFAULT_LIMIT <= (meta.totalCount || 0)

    return {
      items: items.map(record => ({
        label: record.id || `Account ${ record.key }`,
        value: String(record.id),
        note: record.status || `Key: ${ record.key }`,
      })),
      cursor: hasMore ? String(start + DEFAULT_LIMIT) : null,
    }
  }
}

Flowrunner.ServerCode.addService(SageIntacct, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client ID from the Sage Developer Portal.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client Secret from the Sage Developer Portal.',
  },
])

/**
 * @typedef {Object} getObjectTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter object types by name or module."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getRecordsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"description":"The object type to list records for."}
 */

/**
 * @typedef {Object} getRecordsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter records."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 * @paramDef {"type":"getRecordsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Contains the object type to list records for."}
 */

/**
 * @typedef {Object} getBankAccountsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter bank accounts by ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getCustomersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter customers by ID or name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getCreditCardAccountsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter credit card accounts by ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */
