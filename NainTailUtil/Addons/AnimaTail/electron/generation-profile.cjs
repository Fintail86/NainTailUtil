"use strict";

const profile = require("../config/generation-profile.json");

const sampling = Object.freeze({
  samplers: Object.freeze([...profile.sampling.samplers]),
  schedulers: Object.freeze([...profile.sampling.schedulers]),
  defaultSampler: profile.sampling.defaultSampler,
  defaultScheduler: profile.sampling.defaultScheduler,
  minimumSteps: Object.freeze({ ...profile.sampling.minimumSteps }),
});

const outputNaming = Object.freeze({ ...profile.outputNaming });

module.exports = Object.freeze({
  limits: Object.freeze(profile.limits),
  sampling,
  outputNaming,
  turboLoraPrefix: profile.turboLoraPrefix,
});
