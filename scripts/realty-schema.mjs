import apartments from '../data/apartments.json' with { type: 'json' };
import content from '../content-model.js';

export function offerForLot(lot, id) {
  if (!['InStock', 'SoldOut', 'OutOfStock'].includes(lot.developer_availability)
      || !lot.snapshot_date || !(lot.price_rub > 0)) return null;
  return {
    '@type': 'Offer',
    ...id('offer-' + lot.id),
    itemOffered: id('apartment-' + lot.id),
    price: lot.price_rub,
    priceCurrency: 'RUB',
    availability: 'https://schema.org/' + lot.developer_availability,
  };
}

export function catalogOffers(id) {
  return apartments.map(lot => offerForLot(lot, id)).filter(Boolean);
}

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
