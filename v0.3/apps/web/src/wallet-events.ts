import type {Phase2EventContext} from './main.js';
import {routeToPanelKey} from './state.js';
export async function handleWalletEvent(action:string|null,target:HTMLElement,ctx:Phase2EventContext):Promise<boolean>{
 const {state,renderApp,saveCurrentScroll,navigateTo,syncPhase2DomainQuietly}=ctx;
    if (action === 'open-wallet-ledger') {
      const taskIdFilter = target.getAttribute('data-task-id') || null;
      state.walletLedgerTaskFilter = taskIdFilter;state.walletLedgerOffset=0;await syncPhase2DomainQuietly();
      state.modalError = null;
      state.activeModal = { kind: 'wallet-ledger', taskId:taskIdFilter };
      renderApp();
      return true;
    }

    if (action === 'wallet-clear-task-filter') {
      state.walletLedgerTaskFilter = null;state.walletLedgerOffset=0;await syncPhase2DomainQuietly();
      if (state.activeModal?.kind === 'wallet-ledger') {
        state.activeModal = { kind: 'wallet-ledger', taskId:null };
      }
      renderApp();
      return true;
    }

    if (action === 'wallet-go-task') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      if (!taskId) return true;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: state.route,
        fromPanelKey: routeToPanelKey(state.route) ?? 'home',
        savedFilter: { ...state.panels.tasks },
        label: '来自奖励账本流水的来源任务核查'
      };
      state.panels.tasks.selectedId = taskId;
      state.activeModal = { kind: 'task-detail', taskId };
      navigateTo('/tasks', { preserveReturnContext: true });
      return true;
    }
 return false;
}
