import {usePrinterStore} from '@/data/modules/printerStore';
import {isFeatureEnabled} from '@/lib/featureFlags';
import {groupsForCategory,planPrinterJobs as planJobs,splitLinesByPrinterGroup as splitLines,pickOrderPrinter,groupCenter,resolveCategoryId} from '@/services/printRoutingCore';
export {pickOrderPrinter,groupCenter,resolveCategoryId};
export function isPrinterGroupRoutingEnabled(){return isFeatureEnabled('printerGroupRouting');}
export function getPrinterGroupsForItem(categoryId,groups=usePrinterStore.getState().groups){return groupsForCategory(categoryId,groups);}
export function splitLinesByPrinterGroup(lines,opts={}){const {groups,categories}=usePrinterStore.getState();return splitLines(lines,{groups,categories,...opts});}
export function planPrinterJobs(lines,opts={}){const {groups,categories}=usePrinterStore.getState();return planJobs(lines,{groups,categories,...opts});}
