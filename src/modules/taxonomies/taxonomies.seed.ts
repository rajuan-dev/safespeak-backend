import { logger } from '@common/utils/logger';
import { AdminTaxonomyModel } from '@modules/admin/admin.model';

import { DEFAULT_TAXONOMY_RECORDS } from './taxonomies.service';

export const seedDefaultTaxonomies = async (): Promise<void> => {
  if (!DEFAULT_TAXONOMY_RECORDS.length) {
    return;
  }

  const result = await AdminTaxonomyModel.bulkWrite(
    DEFAULT_TAXONOMY_RECORDS.map((record) => ({
      updateOne: {
        filter: {
          type: record.type,
          key: record.key
        },
        update: {
          $setOnInsert: record
        },
        upsert: true
      }
    })),
    { ordered: false }
  );

  logger.info(
    {
      inserted: result.upsertedCount,
      totalDefaults: DEFAULT_TAXONOMY_RECORDS.length
    },
    'Default taxonomies ready'
  );
};
