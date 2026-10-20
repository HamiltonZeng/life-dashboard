import type {Phase2EventContext} from './main.js';
import {TREND_RANGE_META} from '../../../packages/ui/src/index.js';
import {routeToPanelKey,createInitialTrendControlState} from './state.js';
import type {TrendRange,TrendGrain} from './types.js';
export async function handleTrendEvent(action:string|null,target:HTMLElement,ctx:Phase2EventContext):Promise<boolean>{
 const {state,data,pushToast,renderApp,updateHomePreferencesReliably,syncMetricTrendQuietly,saveCurrentScroll,navigateTo}=ctx;
    if (action === 'trend-set-range') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const nextRange = (target.getAttribute('data-range') ?? 'last_7_days') as TrendRange;
      if (!metricId) return true;
      if (!state.metricTrendControls[metricId]) {
        state.metricTrendControls[metricId] = createInitialTrendControlState();
      }
      const ctrl = state.metricTrendControls[metricId];
      ctrl.range = nextRange;
      const allowed = TREND_RANGE_META[nextRange]?.grains ?? ['1d'];
      if (!allowed.includes(ctrl.grain)) {
        ctrl.grain = TREND_RANGE_META[nextRange]?.defaultGrain ?? allowed[0] ?? '1d';
      }
      ctrl.selectedPointKey = null;
      await syncMetricTrendQuietly(metricId);
      renderApp({ preserveModalInput: true });
      return true;
    }

    if (action === 'trend-set-grain') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const nextGrain = (target.getAttribute('data-grain') ?? '1d') as TrendGrain;
      if (!metricId) return true;
      if (!state.metricTrendControls[metricId]) {
        state.metricTrendControls[metricId] = createInitialTrendControlState();
      }
      const ctrl = state.metricTrendControls[metricId];
      ctrl.grain = nextGrain;
      ctrl.selectedPointKey = null;
      await syncMetricTrendQuietly(metricId);
      renderApp({ preserveModalInput: true });
      return true;
    }

    if (action === 'trend-toggle-variance') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      if (!metricId) return true;
      if (!state.metricTrendControls[metricId]) {
        state.metricTrendControls[metricId] = createInitialTrendControlState();
      }
      const ctrl = state.metricTrendControls[metricId];
      ctrl.varianceEnabled = !ctrl.varianceEnabled;
      if (ctrl.varianceEnabled) {
        ctrl.includeAll = false;
      }
      await syncMetricTrendQuietly(metricId);
      renderApp({ preserveModalInput: true });
      return true;
    }

    if (action === 'trend-toggle-include-all') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      if (!metricId) return true;
      if (!state.metricTrendControls[metricId]) {
        state.metricTrendControls[metricId] = createInitialTrendControlState();
      }
      const ctrl = state.metricTrendControls[metricId];
      ctrl.includeAll = !ctrl.includeAll;
      await syncMetricTrendQuietly(metricId);
      renderApp({ preserveModalInput: true });
      return true;
    }

    if (action === 'trend-toggle-exclude-date') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const dateStr = target.getAttribute('data-date') ?? '';
      if (!metricId || !dateStr) return true;
      if (!state.metricTrendControls[metricId]) {
        state.metricTrendControls[metricId] = createInitialTrendControlState();
      }
      const ctrl = state.metricTrendControls[metricId];
      if (ctrl.excludeDates.includes(dateStr)) {
        ctrl.excludeDates = ctrl.excludeDates.filter(d => d !== dateStr);
      } else {
        ctrl.excludeDates = [...ctrl.excludeDates, dateStr];
        ctrl.includeAll = false;
      }
      await syncMetricTrendQuietly(metricId);
      renderApp({ preserveModalInput: true });
      return true;
    }

    if (action === 'trend-select-point') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const bucketKey = target.getAttribute('data-point-key') ?? '';
      if (!metricId || !bucketKey) return true;
      if (!state.metricTrendControls[metricId]) {
        state.metricTrendControls[metricId] = createInitialTrendControlState();
      }
      state.metricTrendControls[metricId].selectedPointKey = bucketKey;
      renderApp({ preserveModalInput: true });
      return true;
    }

    if (action === 'trend-bucket-sources') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const bucketKey = target.getAttribute('data-point-key') ?? '';
      const m = data.metrics.find(x => x.id === metricId);
      const trend = state.metricTrends[metricId];
      const bucket = trend?.buckets.find(b => `${b.start_date}..${b.end_date}` === (bucketKey||state.metricTrendControls[metricId]?.selectedPointKey)) ?? trend?.buckets.at(-1);
      if (!m || !bucket) return true;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: state.route,
        fromPanelKey: routeToPanelKey(state.route) ?? 'home',
        savedFilter: { ...state.panels.metrics },
        label: `来自数值趋势「${m.definition.name} · ${bucket.start_date} ~ ${bucket.end_date}」的来源记录`
      };
      state.panels.records.moduleId = m.module_id;
      state.panels.records.recordTemplateId = m.record_type_id;
      state.panels.records.sourceRecordIds = [...bucket.source_record_ids];
      state.panels.records.sourceLabel = `数值趋势「${m.definition.name} · ${bucket.start_date} ~ ${bucket.end_date}」的 ${bucket.source_record_ids.length} 条来源记录`;
      state.activeModal = null;
      navigateTo('/records', { preserveReturnContext: true });
      return true;
    }

    if (action === 'trend-toggle-pin') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      if (!metricId) return true;
      const ctrl=state.metricTrendControls[metricId]??createInitialTrendControlState();
      const current=[...(state.homePreferences?.pinned_trends??[])];
      const exists=current.some(p=>p.metric_id===metricId);
      if(!exists&&current.length>=2){pushToast('固定数量已满','最多固定两张趋势，请先取消其他趋势','warning');return true;}
      const next=exists?current.filter(p=>p.metric_id!==metricId):[...current,{metric_id:metricId,range:ctrl.range,grain:ctrl.grain,precision:ctrl.precision,view_filter:{exclude_dates:[...ctrl.excludeDates],variance_enabled:ctrl.varianceEnabled,variance_threshold:ctrl.varianceThreshold,minimum_days:ctrl.minimumDays,include_all:ctrl.includeAll}}];
      await updateHomePreferencesReliably({pinned_trends:next},exists?'已取消固定趋势':'已固定当前范围、粒度和筛选');
      return true;
    }

 return false;
}
