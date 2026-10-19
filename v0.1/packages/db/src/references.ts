/** Shared active-metric lookup for manual commands and AI reference resolution. */
export type Query = (text: string, values: unknown[]) => Promise<{rows: any[]}>;
export async function activeMetrics(query: Query,user: string,module: string,id?: string) {
  return (await query(`SELECT d.* FROM metric_definitions d
    JOIN modules m ON m.user_id=d.user_id AND m.id=d.module_id
    WHERE d.user_id=$1 AND d.module_id=$2 AND d.archived_at IS NULL AND m.status='enabled'${id?' AND d.id=$3':''}`,
  id?[user,module,id]:[user,module])).rows;
}
