import type { PipelineStage } from 'mongoose';
import type { PageMeta, PaginationQuery } from '@stockflow/shared';

type FacetStage = PipelineStage.FacetPipelineStage;

/**
 * Appends a $facet that returns one page of rows plus the total count.
 * `rowStages` run only on the page's rows (e.g. lookups for display).
 */
export function paginateStages(
  query: PaginationQuery,
  rowStages: FacetStage[] = [],
): PipelineStage[] {
  return [
    {
      $facet: {
        rows: [
          { $skip: (query.page - 1) * query.pageSize },
          { $limit: query.pageSize },
          ...rowStages,
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
}

export function pageResult<TRow, TDto>(
  result: { rows: TRow[]; total: { count: number }[] }[],
  query: PaginationQuery,
  map: (row: TRow) => TDto,
): { data: TDto[]; meta: PageMeta } {
  const facet = result[0] ?? { rows: [], total: [] };
  return {
    data: facet.rows.map(map),
    meta: { page: query.page, pageSize: query.pageSize, total: facet.total[0]?.count ?? 0 },
  };
}
