import fs from 'node:fs';
import {browserLots, catalogMarkup, calculatorDefaults} from './catalog-presentation.mjs';
import {catalogGraph, catalogOffers} from './realty-schema.mjs';

const {lots, date} = JSON.parse(fs.readFileSync(0, 'utf8'));
const origin = 'https://zhk-dom-umorya.ru/';
const id = key => ({'@id': origin + '#' + key});
const groups = new Set(lots.map(lot => lot.plan_group_id)).size;
const unconfirmed = lots.map(lot => ({...lot, developer_availability: null}));
const snapshot = {
  schema: 1, date, lots,
  browser: browserLots(lots),
  catalog_html: catalogMarkup(lots, groups),
  unconfirmed_html: catalogMarkup(unconfirmed, groups),
  calculator: calculatorDefaults(lots),
  graph: catalogGraph(id, lots),
  offers: catalogOffers(id, lots),
};
process.stdout.write(JSON.stringify(snapshot));
