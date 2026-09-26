const ROLE_ATTRIBUTE = 'traccarToolRole';
const ROLE_NUMBER_ATTRIBUTE = 'traccarToolRoleNumber';

export const roleMarkerRoles = ['player', 'supporter', 'hunter'];

export const normalizePositiveInteger = (value) => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replace(/^0+/, '');
  return normalized || null;
};

export const roleNumberTextSize = (number) =>
  Math.max(6, Math.round(15 - Math.max(0, String(number).length - 1) * 1.5));

export const resolveRoleMarker = (device) => {
  const attributes = device?.attributes || {};
  const role = attributes[ROLE_ATTRIBUTE];
  if (!roleMarkerRoles.includes(role)) {
    return null;
  }

  const number = normalizePositiveInteger(attributes[ROLE_NUMBER_ATTRIBUTE]);
  if (!number) {
    return null;
  }

  return {
    role,
    number,
    image: `role-${role}`,
    textSize: roleNumberTextSize(number),
  };
};
