import { fail } from './errors.mjs';
import { projectFields } from './fields.mjs';
import { responseBytes } from './limits.mjs';
import { jsonBytes } from './response.mjs';

export function updatePage(page) {
  page.hasMore = page.offset + page.tasks.length < page.total;
  page.nextOffset = page.hasMore ? page.offset + page.tasks.length : null;
  return page;
}

export function taskPage(records, { offset, limit, stores, fields, total = records.length, recordsOffset = offset }) {
  const page = updatePage({ tasks: [], total, offset, limit, stores, fields });
  if (jsonBytes(page) + 1 > responseBytes) {
    fail('OUTPUT_TOO_LARGE', 'list metadata exceeds 32 KiB; select fewer --fields or stores');
  }
  for (let index = recordsOffset; index < records.length && page.tasks.length < limit; index++) {
    page.tasks.push(projectFields(records[index], fields));
    updatePage(page);
    if (jsonBytes(page) + 1 > responseBytes) {
      page.tasks.pop();
      updatePage(page);
      if (!page.tasks.length) {
        fail('OUTPUT_TOO_LARGE', `task ${records[index].id} cannot fit in a 32 KiB page; select fewer --fields`);
      }
      break;
    }
  }
  return page;
}
