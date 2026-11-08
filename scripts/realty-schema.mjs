import apartments from '../data/apartments.json' with { type: 'json' };
import content from '../content-model.js';

// Use the same lot IDs, titles and measurements as the static catalogue.
export function catalogGraph(id) {
  const units = content.plans(apartments).map(lot => ({
    '@type': 'Apartment',
    ...id('apartment-' + lot.id),
    identifier: lot.id,
    name: lot.title,
    containedInPlace: id('complex'),
    floorLevel: String(lot.floor),
    floorSize: {
      '@type': 'QuantitativeValue',
      value: lot.area_m2,
      unitCode: 'MTK',
    },
    numberOfBedrooms: lot.bedrooms,
  }));

  const catalog = {
    '@type': 'ItemList',
    ...id('plans'),
    name: 'Квартиры ЖК «Дом у моря»',
    numberOfItems: units.length,
    itemListElement: units.map(unit => ({ '@id': unit['@id'] })),
  };
  return [catalog, ...units];
}
