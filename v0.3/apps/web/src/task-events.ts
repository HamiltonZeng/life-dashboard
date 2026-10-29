import {planning} from './planning-ui.js';
import type {Phase2EventContext} from './main.js';
export async function handleTaskEvent(action:string|null,target:HTMLElement,ctx:Phase2EventContext):Promise<boolean>{
 const {state,refreshPeriodic,pushToast,handleApiError,prepareConfigFormModal,renderApp,updateHomePreferencesReliably}=ctx;
    if (action === 'task-materialize-current') {
      try {
        await refreshPeriodic(true);
        if(state.periodicSync?.status==='ready')pushToast('已刷新','已确保并刷新当前周期任务实例','success');
      } catch (err) {
        handleApiError(err);
      }
      return true;
    }

    if (action === 'open-create-task-template') {
      planning.advanced=false;
      prepareConfigFormModal('create-task-template', {
        kind: 'create-task-template',
        defaultModuleId: state.panels.tasks.moduleId
      });
      renderApp();
      return true;
    }

    if (action === 'open-edit-task-template') {
      const templateId = target.getAttribute('data-template-id') ?? '';
      if (!templateId) return true;
      state.modalError = null;
      state.activeModal = { kind: 'edit-task-template', templateId };
      renderApp();
      return true;
    }

    if (action === 'open-revoke-task') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      if (!taskId) return true;
      state.modalError = null;
      state.activeModal = { kind: 'revoke-task', taskId, mode: 'revoke' };
      renderApp();
      return true;
    }

    if (action === 'open-cancel-task') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      if (!taskId) return true;
      state.modalError = null;
      state.activeModal = { kind: 'revoke-task', taskId, mode: 'cancel' };
      renderApp();
      return true;
    }

    if (action === 'task-toggle-typed-pin') {
      const pinKind = (target.getAttribute('data-pin-kind') ?? 'instance') as 'template' | 'instance';
      const pinId = target.getAttribute('data-pin-id') ?? '';
      if (!pinId) return true;
      const current = [...(state.homePreferences?.task_pins ?? [])];
      const exists = current.some(p => p.kind === pinKind && p.id === pinId);
      const next = exists ? current.filter(p => !(p.kind === pinKind && p.id === pinId)) : [...current, {kind:pinKind,id:pinId}];
      if(next.length>5){pushToast('固定数量已满','最多固定5项任务，请先取消其他固定','warning');return true;}
      await updateHomePreferencesReliably({task_pins:next},exists?'已取消首页固定':'已固定到首页');
      return true;
    }

 return false;
}
