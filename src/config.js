var dotenv = require('dotenv');

dotenv.config({ quiet: true });

function trimTrailingSlash(value) {
  return value ? value.replace(/\/+$/, '') : value;
}

function toInt(value, fallback) {
  var parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value).toLowerCase() === 'true';
}

function required(value, name) {
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }

  return value;
}

/**
 * Optional URL segment before /Patient/:id for PUT (and OpenHIM channel matching).
 * Example: openmrs-fhir-mdm -> PUT /openmrs-fhir-mdm/Patient/1001
 * Set MEDIATOR_PATH_PREFIX= (empty) to expose only PUT /Patient/:id at the server root.
 */
function mediatorPathPrefix() {
  var raw = process.env.MEDIATOR_PATH_PREFIX;
  if (raw === '') {
    return '';
  }
  if (raw === undefined || raw === null) {
    return 'openmrs-fhir-mdm';
  }
  return String(raw).replace(/^\/+|\/+$/g, '');
}

/**
 * Comma-separated HAPI MDM matchResult values to accept (e.g. MATCH,POSSIBLE_MATCH).
 * Empty, "any", or "*" => MATCH and POSSIBLE_MATCH (recommended for auto-linked patients).
 */
function parseMdmMatchResults(value) {
  var trimmed;

  if (value === undefined || value === null) {
    return ['MATCH', 'POSSIBLE_MATCH'];
  }

  trimmed = String(value).trim();
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'any') {
    return ['MATCH', 'POSSIBLE_MATCH'];
  }

  return trimmed.split(',').map(function (entry) {
    return entry.trim();
  }).filter(Boolean);
}

var config = {
  port: toInt(process.env.PORT, 3000),
  mediatorPathPrefix: mediatorPathPrefix(),
  fhir: {
    baseUrl: trimTrailingSlash(required(process.env.FHIR_BASE_URL, 'FHIR_BASE_URL')),
    username: process.env.FHIR_USERNAME || '',
    password: process.env.FHIR_PASSWORD || '',
    timeoutMs: toInt(process.env.FHIR_TIMEOUT_MS, 15000),
    patientPath: process.env.FHIR_PATIENT_PATH || '/Patient',
    mdmQueryPath: process.env.FHIR_MDM_QUERY_PATH || '/$mdm-query-links',
    mdmMatchResults: parseMdmMatchResults(process.env.FHIR_MDM_MATCH_RESULT),
    mdmPollCount: toInt(process.env.FHIR_MDM_POLL_COUNT, 6),
    mdmFirstPollDelayMs: toInt(process.env.FHIR_MDM_FIRST_POLL_DELAY_MS, 30000),
    mdmPollDelayMs: toInt(process.env.FHIR_MDM_POLL_DELAY_MS, 1000),
    mdmResourceIdMode: process.env.FHIR_MDM_RESOURCE_ID_MODE || 'id',
    cruidSystem: process.env.FHIR_CRUID_SYSTEM || 'urn:intelehealth:cruid',
    mdmGoldenEnterpriseIdSystem:
      process.env.FHIR_MDM_GOLDEN_ENTERPRISE_ID_SYSTEM ||
      'http://hapifhir.io/fhir/NamingSystem/mdm-golden-resource-enterprise-id',
    mpiIdentifierTypeText: process.env.FHIR_MPI_IDENTIFIER_TYPE_TEXT || 'MPI'
  },
  openmrs: {
    idSystem: process.env.OPENMRS_ID_SYSTEM || 'urn:openmrs:patient-uuid'
  },
  mediatorAuth: {
    username: process.env.MEDIATOR_BASIC_AUTH_USERNAME || '',
    password: process.env.MEDIATOR_BASIC_AUTH_PASSWORD || ''
  },
  openhim: {
    register: toBool(process.env.OPENHIM_REGISTER, false),
    apiUrl: trimTrailingSlash(process.env.OPENHIM_API_URL || ''),
    username: process.env.OPENHIM_USERNAME || '',
    password: process.env.OPENHIM_PASSWORD || '',
    urn: process.env.OPENHIM_MEDIATOR_URN || 'urn:mediator:openmrs-fhir-mpi',
    routerUrl: trimTrailingSlash(process.env.OPENHIM_ROUTER_URL || ''),
    trustSelfSigned: toBool(process.env.OPENHIM_TRUST_SELF_SIGNED, true),
    heartbeatMs: toInt(process.env.OPENHIM_HEARTBEAT_MS, 10000)
  }
};

module.exports = config;
