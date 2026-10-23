import { expect, it } from 'vitest';
import { productImageSources } from '../productImages';
it('tries repaired proxy, original URL and own gallery without looping', () => {
  const src='/foto/wp/2026/10/gear.png?v=20261023';
  expect(productImageSources([src,src,'https://cdn.test/a.jpg'])).toEqual([src,'https://gnnkracing.id/wp-content/uploads/2026/10/gear.png','https://cdn.test/a.jpg']);
});
it('rejects unsafe links and never maps traversal to the WordPress origin', () => {
  expect(productImageSources(['javascript:alert(1)','//evil.test/a','data:text/html,test'])).toEqual([]);
  expect(productImageSources(['/foto/wp/2026/10/../../config.png'])).toEqual(['/foto/wp/2026/10/../../config.png']);
});
