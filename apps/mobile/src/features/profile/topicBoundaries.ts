import catalog from '../../../../../shared/topic-boundaries.json';

const supported = new Set(Object.values(catalog.categories).flatMap(category => category.labels));
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().replace(/\s+/g, ' ');

export function needsBoundaryReview(topics: string[]) {
  return topics.some(topic => !supported.has(normalized(topic)));
}
