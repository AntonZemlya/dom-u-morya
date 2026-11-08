import apartments from '../data/apartments.json' with { type: 'json' };
import content from '../content-model.js';

// Use the same lot IDs, titles and measurements as the static catalogue.
export function developerListing(lot) {
  if (!['InStock', 'SoldOut', 'OutOfStock'].includes(lot.developer_availability)
      || !lot.source_url || !lot.snapshot_date || !(lot.price_rub > 0)) return {};
  return {
    subjectOf: {
      '@type': 'RealEstateListing',
      url: lot.source_url,
      name: lot.title,
      offers: {
        '@type': 'Offer',
        price: lot.price_rub,
        priceCurrency: 'RUB',
        availability: 'https://schema.org/' + lot.developer_availability,
        url: lot.source_url,
      },
    },
  };
}

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
    ...developerListing(lot),
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
