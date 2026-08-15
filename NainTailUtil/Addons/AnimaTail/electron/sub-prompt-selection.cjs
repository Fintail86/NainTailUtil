"use strict";

function selectedSubPromptEntries(items) {
  const requested = Array.isArray(items) ? items : [];
  return requested
    .map((item, index) => ({ item, slotNumber: index + 1 }))
    .filter(({ item }) => item?.enabled !== false);
}

module.exports = { selectedSubPromptEntries };
