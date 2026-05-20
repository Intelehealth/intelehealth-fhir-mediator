function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function firstDefined(values) {
  var index;

  for (index = 0; index < values.length; index += 1) {
    if (values[index] !== undefined && values[index] !== null && values[index] !== '') {
      return values[index];
    }
  }

  return undefined;
}

function uniqueIdentifiers(identifiers) {
  var seen = {};

  return identifiers.filter(function (identifier) {
    var key;

    if (!identifier || !identifier.value) {
      return false;
    }

    key = (identifier.system || '') + '|' + identifier.value;
    if (seen[key]) {
      return false;
    }

    seen[key] = true;
    return true;
  });
}

function toIdentifierSystem(identifierType) {
  if (!identifierType) {
    return undefined;
  }

  if (typeof identifierType === 'string') {
    return 'urn:openmrs:identifier-type:' + identifierType;
  }

  if (identifierType.uuid) {
    return 'urn:openmrs:identifier-type:' + identifierType.uuid;
  }

  if (identifierType.name) {
    return 'urn:openmrs:identifier-type:' + identifierType.name;
  }

  return undefined;
}

function normalizeGender(value) {
  var normalized = value ? String(value).toLowerCase() : '';

  if (normalized === 'm' || normalized === 'male') {
    return 'male';
  }

  if (normalized === 'f' || normalized === 'female') {
    return 'female';
  }

  if (normalized === 'o' || normalized === 'other') {
    return 'other';
  }

  if (normalized === 'u' || normalized === 'unknown') {
    return 'unknown';
  }

  return undefined;
}

function normalizeBirthDate(value) {
  if (!value) {
    return undefined;
  }

  return String(value).split('T')[0];
}

function extractSourcePatient(payload) {
  if (!payload) {
    return {};
  }

  if (payload.patient) {
    return payload.patient;
  }

  return payload;
}

function extractPerson(patient) {
  if (patient.person) {
    return patient.person;
  }

  return patient;
}

function extractPreferredName(person) {
  var names = asArray(person.names);
  var index;

  if (person.preferredName) {
    return person.preferredName;
  }

  for (index = 0; index < names.length; index += 1) {
    if (names[index] && names[index].preferred) {
      return names[index];
    }
  }

  return names[0] || person.name || {};
}

function extractTelecom(patient, person) {
  var attributes = asArray(person.attributes);
  var telecom = [];

  if (patient.phoneNumber) {
    telecom.push({
      system: 'phone',
      value: patient.phoneNumber
    });
  }

  attributes.forEach(function (attribute) {
    var attributeType = attribute && attribute.attributeType;
    var typeName = attributeType && (attributeType.display || attributeType.name || attributeType.uuid);

    if (!attribute || !attribute.value || !typeName) {
      return;
    }

    if (String(typeName).toLowerCase().indexOf('phone') !== -1) {
      telecom.push({
        system: 'phone',
        value: attribute.value
      });
    }
  });

  return telecom;
}

function extractAddress(person) {
  var address = asArray(person.addresses)[0];

  if (!address) {
    return undefined;
  }

  return [{
    use: 'home',
    line: [address.address1, address.address2, address.address3].filter(Boolean),
    city: address.cityVillage,
    district: address.countyDistrict,
    state: address.stateProvince,
    postalCode: address.postalCode,
    country: address.country
  }];
}

function mapIdentifiers(patient, defaultSystem) {
  var identifiers = [];
  var patientIdentifiers = asArray(patient.identifiers);

  if (patient.uuid) {
    identifiers.push({
      system: defaultSystem,
      value: patient.uuid
    });
  }

  patientIdentifiers.forEach(function (identifier) {
    var value;

    if (!identifier) {
      return;
    }

    if (typeof identifier === 'string') {
      identifiers.push({ value: identifier });
      return;
    }

    value = identifier.identifier || identifier.value;
    if (!value) {
      return;
    }

    identifiers.push({
      use: identifier.preferred ? 'usual' : undefined,
      system: identifier.system || toIdentifierSystem(identifier.identifierType),
      value: value
    });
  });

  return uniqueIdentifiers(identifiers);
}

function compactObject(object) {
  var result = {};

  Object.keys(object).forEach(function (key) {
    if (object[key] !== undefined && object[key] !== null) {
      result[key] = object[key];
    }
  });

  return result;
}

function transformOpenmrsPatient(payload, options) {
  var patient = extractSourcePatient(payload);
  var person = extractPerson(patient);
  var preferredName = extractPreferredName(person);
  var given = [preferredName.givenName, preferredName.middleName].filter(Boolean);
  var telecom = extractTelecom(patient, person);
  var addresses = extractAddress(person);
  var birthDate = firstDefined([patient.birthDate, person.birthdate, person.birthDate]);
  var gender = firstDefined([patient.gender, person.gender]);
  var fhirPatient = {
    resourceType: 'Patient',
    active: payload.active === false ? false : true,
    identifier: mapIdentifiers(patient, options.openmrsIdSystem),
    name: preferredName.familyName || given.length ? [{
      use: 'official',
      family: preferredName.familyName,
      given: given
    }] : undefined,
    gender: normalizeGender(gender),
    birthDate: normalizeBirthDate(birthDate),
    telecom: telecom.length ? telecom : undefined,
    address: addresses
  };

  return compactObject(fhirPatient);
}

function toFhirPatient(payload, options) {
  if (payload && payload.resourceType === 'Patient') {
    return payload;
  }

  return transformOpenmrsPatient(payload, options);
}

module.exports = {
  toFhirPatient: toFhirPatient
};
