import React from 'react';
import { byIncident } from './incidents.js';
import './proof.css';

// Small citation chip: "Badger 2021". Links to that incident's card in the record.
// Used wherever a claim on the site is backed by a documented incident.
export default function Proof({ ids, label = 'Seen in' }) {
  const items = ids.map((id) => byIncident[id]).filter(Boolean);
  if (!items.length) return null;
  return <span className="pf-chips" aria-label={`${label}: ${items.map((i) => `${i.name}, ${i.year}`).join('; ')}`}>
    <span className="pf-chips-label" aria-hidden="true">{label}</span>
    {items.map((i) => <a key={i.id} className="pf-chip" href={`#incident-${i.id}`}>{i.name.split(' ')[0]} <b>{i.year}</b></a>)}
  </span>;
}
