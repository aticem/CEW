// QA/QC Base Schema - Fixed folder structure
// This defines the required structure that always exists

export const QAQC_SCHEMA = {
  ITPs: {
    type: 'category',
    label: 'ITPs',
    fixed: true,
    children: {
      'itp-civil': {
        type: 'folder',
        label: 'Civil',
        fixed: true,
        publicPath: '/QAQC/ITPs/civil',
        children: {},
      },
      'itp-electrical': {
        type: 'folder',
        label: 'Electrical',
        fixed: true,
        publicPath: '/QAQC/ITPs/electrical',
        children: {},
      },
      'itp-mechanical': {
        type: 'folder',
        label: 'Mechanical',
        fixed: true,
        publicPath: '/QAQC/ITPs/mechanical',
        children: {},
      },
    },
  },
  Checklists: {
    type: 'category',
    label: 'Checklists',
    fixed: true,
    children: {
      'cl-electrical': {
        type: 'folder',
        label: 'Electrical',
        fixed: true,
        children: {
          'cl-dc-cable': {
            type: 'folder',
            label: 'DC Cable Laying & Termination',
            fixed: true,
            allowMultiple: true,
            publicPath: '/QAQC/Checklists/electrical/dc-cable',
            children: {},
          },
          'cl-earthing-foc': {
            type: 'folder',
            label: 'Earthing & FOC',
            fixed: true,
            allowMultiple: true,
            publicPath: '/QAQC/Checklists/electrical/earthing-foc',
            children: {},
          },
          'cl-inverter-lv': {
            type: 'folder',
            label: 'Installation Inverter & LV Boxes Installation',
            fixed: true,
            allowMultiple: true,
            publicPath: '/QAQC/Checklists/electrical/inverter-lv',
            children: {},
          },
        },
      },
      'cl-mechanical': {
        type: 'folder',
        label: 'Mechanical',
        fixed: true,
        children: {
          'cl-module-installation': {
            type: 'folder',
            label: 'Module Installation',
            fixed: true,
            allowMultiple: true,
            publicPath: '/QAQC/Checklists/mechanical/module-installation',
            children: {},
          },
          'cl-mounting-structure': {
            type: 'folder',
            label: 'Mounting Structure Assembly',
            fixed: true,
            allowMultiple: true,
            publicPath: '/QAQC/Checklists/mechanical/mounting-structure-assembly',
            children: {},
          },
        },
      },
    },
  },
  NCRs: {
    type: 'category',
    label: 'NCRs',
    fixed: true,
    isNCR: true,
    allowMultiple: true,
    publicPath: '/QAQC/NCRs',
    children: {},
  },
  ThirdParty: {
    type: 'category',
    label: 'Third Party',
    fixed: true,
    children: {
      'tp-dnv': {
        type: 'folder',
        label: 'DNV',
        fixed: true,
        allowMultiple: true,
        publicPath: '/QAQC/ThirdParty/DNV',
        children: {},
      },
      'tp-cea': {
        type: 'folder',
        label: 'CEA',
        fixed: true,
        allowMultiple: true,
        publicPath: '/QAQC/ThirdParty/CEA',
        children: {},
      },
    },
  },
  Random: {
    type: 'category',
    label: 'Random',
    fixed: true,
    allowFolderCreation: true,
    allowMultiple: true,
    children: {},
  },
};

// Status definitions
export const DOC_STATUSES = {
  INCOMPLETE: { key: 'incomplete', label: 'Incomplete', color: '#ef4444', bgColor: 'rgba(239,68,68,0.15)' },
  IN_PROGRESS: { key: 'in_progress', label: 'In Progress', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.15)' },
  COMPLETED: { key: 'completed', label: 'Completed', color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
};

export const NCR_STATUSES = {
  OPEN: { key: 'open', label: 'Open', color: '#ef4444', bgColor: 'rgba(239,68,68,0.15)' },
  IN_PROGRESS: { key: 'in_progress', label: 'In Progress', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.15)' },
  CLOSED: { key: 'closed', label: 'Closed', color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
};

// Helper to generate unique IDs
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
