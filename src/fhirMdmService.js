var axios = require('axios');

function buildAuth(config) {
  if (!config.fhir.username) {
    return undefined;
  }

  return {
    username: config.fhir.username,
    password: config.fhir.password
  };
}

function buildRequestConfig(config) {
  return {
    timeout: config.fhir.timeoutMs,
    auth: buildAuth(config),
    headers: {
      Accept: 'application/fhir+json',
      'Content-Type': 'application/fhir+json'
    }
  };
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function joinUrl(baseUrl, path) {
  if (!path) {
    return baseUrl;
  }

  if (path.charAt(0) === '/') {
    return baseUrl + path;
  }

  return baseUrl + '/' + path;
}

function extractIdFromLocation(locationHeader) {
  var cleaned;
  var segments;

  if (!locationHeader) {
    return undefined;
  }

  cleaned = locationHeader.split('/_history/')[0];
  segments = cleaned.split('/');
  return segments[segments.length - 1];
}

async function createPatient(patient, config) {
  var url = joinUrl(config.fhir.baseUrl, config.fhir.patientPath);
  var response = await axios.post(url, patient, buildRequestConfig(config));
  var id = response.data && response.data.id ? response.data.id : extractIdFromLocation(response.headers && response.headers.location);

  if (!id) {
    throw new Error('FHIR create succeeded but no Patient id was returned.');
  }

  return {
    id: id,
    resource: response.data
  };
}

function partValue(part) {
  if (!part) {
    return undefined;
  }

  return part.valueString || part.valueUri || part.valueCode || part.valueId;
}

function getLinkPart(link, name) {
  var parts = (link && link.part) || [];
  var index;

  for (index = 0; index < parts.length; index += 1) {
    if (parts[index].name === name) {
      return partValue(parts[index]);
    }
  }

  return undefined;
}

function extractLinks(parameters) {
  return ((parameters && parameters.parameter) || []).filter(function (entry) {
    return entry.name === 'link';
  });
}

function matchesPatientId(sourceResourceId, patientId) {
  return sourceResourceId === patientId || sourceResourceId === ('Patient/' + patientId);
}

var MDM_MATCH_RESULT_PRIORITY = {
  MATCH: 0,
  POSSIBLE_MATCH: 1,
  NO_MATCH: 2
};

function matchResultPriority(matchResult) {
  if (Object.prototype.hasOwnProperty.call(MDM_MATCH_RESULT_PRIORITY, matchResult)) {
    return MDM_MATCH_RESULT_PRIORITY[matchResult];
  }

  return 99;
}

function isAcceptedMatchResult(matchResult, acceptedMatchResults) {
  if (!acceptedMatchResults || !acceptedMatchResults.length) {
    return true;
  }

  return acceptedMatchResults.indexOf(matchResult) !== -1;
}

function selectBestGoldenResourceId(parameters, patientId, acceptedMatchResults) {
  var links = extractLinks(parameters);
  var index;
  var goldenResourceId;
  var sourceResourceId;
  var matchResult;
  var priority;
  var bestGoldenResourceId;
  var bestPriority = 99;

  for (index = 0; index < links.length; index += 1) {
    goldenResourceId = getLinkPart(links[index], 'goldenResourceId');
    sourceResourceId = getLinkPart(links[index], 'sourceResourceId') || getLinkPart(links[index], 'resourceId');
    matchResult = getLinkPart(links[index], 'matchResult');

    if (!goldenResourceId || (patientId && !matchesPatientId(sourceResourceId, patientId))) {
      continue;
    }

    if (!isAcceptedMatchResult(matchResult, acceptedMatchResults)) {
      continue;
    }

    priority = matchResultPriority(matchResult);
    if (priority < bestPriority) {
      bestGoldenResourceId = goldenResourceId;
      bestPriority = priority;
    }
  }

  return bestGoldenResourceId;
}

async function queryMdmLinks(patientId, config) {
  var params = {
    resourceType: 'Patient',
    resourceId: config.fhir.mdmResourceIdMode === 'reference' ? ('Patient/' + patientId) : patientId
  };
  var url = joinUrl(config.fhir.baseUrl, config.fhir.mdmQueryPath);
  var requestConfig = buildRequestConfig(config);
  var response;

  // HAPI filters server-side on a single matchResult; omit when multiple are accepted.
  if (config.fhir.mdmMatchResults && config.fhir.mdmMatchResults.length === 1) {
    params.matchResult = config.fhir.mdmMatchResults[0];
  }

  requestConfig.params = params;
  response = await axios.get(url, requestConfig);
  return response.data;
}

async function waitForGoldenResourceId(patientId, config) {
  var attempt;
  var parameters;
  var goldenResourceId;
  var firstDelayMs = config.fhir.mdmFirstPollDelayMs;

  if (firstDelayMs > 0) {
    await sleep(firstDelayMs);
  }

  for (attempt = 0; attempt < config.fhir.mdmPollCount; attempt += 1) {
    parameters = await queryMdmLinks(patientId, config);
    goldenResourceId = selectBestGoldenResourceId(parameters, patientId, config.fhir.mdmMatchResults);

    if (goldenResourceId) {
      return goldenResourceId;
    }

    if (attempt < config.fhir.mdmPollCount - 1) {
      await sleep(config.fhir.mdmPollDelayMs);
    }
  }

  throw new Error('Golden patient link was not available after ' + config.fhir.mdmPollCount + ' attempts.');
}

async function getPatientByReference(reference, config) {
  var sanitizedReference = String(reference || '').replace(/^\/+/, '');
  var url = joinUrl(config.fhir.baseUrl, sanitizedReference);
  var response = await axios.get(url, buildRequestConfig(config));

  return response.data;
}

function getIdentifierValue(patient, system) {
  var identifiers = (patient && patient.identifier) || [];
  var index;

  for (index = 0; index < identifiers.length; index += 1) {
    if (identifiers[index].system === system && identifiers[index].value) {
      return identifiers[index].value;
    }
  }

  return undefined;
}

async function createPatientAndResolveGoldenRecord(patient, config) {
  var created = await createPatient(patient, config);
  var goldenResourceId = await waitForGoldenResourceId(created.id, config);
  var goldenPatient = await getPatientByReference(goldenResourceId, config);
  var cruid = getIdentifierValue(goldenPatient, config.fhir.cruidSystem);

  if (!cruid) {
    throw new Error(
      'Golden patient ' +
      goldenResourceId +
      ' was found, but identifier system ' +
      config.fhir.cruidSystem +
      ' is missing.'
    );
  }

  return {
    sourcePatientId: created.id,
    goldenResourceId: goldenResourceId,
    cruid: cruid,
    createdPatient: created.resource,
    goldenPatient: goldenPatient
  };
}

function extractMdmGoldenValueFromPatient(patient, config) {
  var ids = (patient && patient.identifier) || [];
  var i;
  var t;
  var sys = config.fhir.mdmGoldenEnterpriseIdSystem;
  var mpiText = (config.fhir.mpiIdentifierTypeText || 'MPI').toLowerCase();

  for (i = 0; i < ids.length; i += 1) {
    if (ids[i] && ids[i].system === sys && ids[i].value) {
      return String(ids[i].value);
    }
  }
  for (i = 0; i < ids.length; i += 1) {
    t = ((ids[i] && ids[i].type && ids[i].type.text) || '').toLowerCase();
    if (ids[i] && ids[i].value && t === mpiText) {
      return String(ids[i].value);
    }
  }
  return undefined;
}

function ensureMdmGoldenEnterpriseIdentifier(patient, config) {
  var sys = config.fhir.mdmGoldenEnterpriseIdSystem;
  var golden = extractMdmGoldenValueFromPatient(patient, config);
  if (!patient || !golden || !sys) {
    return;
  }
  patient.identifier = (patient.identifier || []).filter(function (entry) {
    return !(entry && entry.system === sys);
  });
  patient.identifier.push({
    system: sys,
    value: golden
  });
}

async function updatePatient(patientId, patient, config) {
  var path = config.fhir.patientPath + '/' + encodeURIComponent(patientId);
  var url = joinUrl(config.fhir.baseUrl, path);
  var response = await axios.put(url, patient, buildRequestConfig(config));
  var data = response.data || {};
  var id = data.id ? data.id : patientId;

  return {
    id: id,
    resource: data
  };
}

async function updatePatientAndResolveGoldenRecord(patientId, patient, config) {
  ensureMdmGoldenEnterpriseIdentifier(patient, config);
  var updated = await updatePatient(patientId, patient, config);
  var goldenResourceId = await waitForGoldenResourceId(updated.id, config);
  var goldenPatient = await getPatientByReference(goldenResourceId, config);
  var cruid = getIdentifierValue(goldenPatient, config.fhir.cruidSystem);

  if (!cruid) {
    throw new Error(
      'Golden patient ' +
      goldenResourceId +
      ' was found, but identifier system ' +
      config.fhir.cruidSystem +
      ' is missing.'
    );
  }

  return {
    sourcePatientId: updated.id,
    goldenResourceId: goldenResourceId,
    cruid: cruid,
    createdPatient: updated.resource,
    goldenPatient: goldenPatient
  };
}

module.exports = {
  createPatientAndResolveGoldenRecord: createPatientAndResolveGoldenRecord,
  updatePatientAndResolveGoldenRecord: updatePatientAndResolveGoldenRecord
};
