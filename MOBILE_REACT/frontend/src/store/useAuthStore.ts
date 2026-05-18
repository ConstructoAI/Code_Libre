/**
 * Mobile React Frontend - Auth Zustand Store
 * Mobile authentication: tenant -> employee select -> PIN -> JWT
 */

import { create } from 'zustand';
import type { EmployeeInfo, TenantInfo } from '@/types';
import * as authApi from '@/api/auth';
import { extractApiError } from '@/types/api';

type LoginStep = 'tenant' | 'employee' | 'pin' | 'done';

/** Cle localStorage pour persister le role apres reload. */
const ROLE_STORAGE_KEY = 'mobile_role';

/** Lecture safe du localStorage : crash silencieusement en Safari private mode
 *  ou iOS MDM, fallback EMPLOYE pour ne pas casser le boot de l'app. */
function _safeGetRole(): string {
  try {
    return localStorage.getItem(ROLE_STORAGE_KEY) || 'EMPLOYE';
  } catch {
    return 'EMPLOYE';
  }
}

interface AuthState {
  employee: EmployeeInfo | null;
  tenant: TenantInfo | null;
  employees: EmployeeInfo[];
  selectedEmployee: EmployeeInfo | null;
  /** Role RBAC: ADMIN | MANAGER | EMPLOYE | APPRENTI. Fallback EMPLOYE
   *  pour JWT legacy sans champ role. */
  role: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginStep: LoginStep;

  loginTenant: (email: string, password: string) => Promise<void>;
  selectEmployee: (employee: EmployeeInfo) => void;
  loginPin: (pinCode: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
  clearError: () => void;
  resetLoginStep: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  employee: null,
  tenant: null,
  employees: [],
  selectedEmployee: null,
  role: _safeGetRole(),
  isAuthenticated: false,
  isLoading: false,
  error: null,
  loginStep: 'tenant',

  loginTenant: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.tenantLogin(email, password);
      set({
        tenant: {
          tenantId: res.tenantId,
          tenantNom: res.tenantNom,
          schemaName: res.schemaName,
        },
        employees: res.employees,
        loginStep: 'employee',
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: extractApiError(err) });
    }
  },

  selectEmployee: (employee) => {
    set({
      selectedEmployee: employee,
      loginStep: 'pin',
      error: null,
    });
  },

  loginPin: async (pinCode) => {
    const { tenant, selectedEmployee } = get();
    if (!tenant || !selectedEmployee) {
      set({ error: 'Veuillez sélectionner une entreprise et un employé' });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.pinLogin(tenant.tenantId, selectedEmployee.id, pinCode);
      // Persiste le role pour survivre au reload (utilise par checkAuth)
      const role = res.role || 'EMPLOYE';
      try {
        localStorage.setItem(ROLE_STORAGE_KEY, role);
      } catch {
        // ignore quota errors
      }
      set({
        employee: res.employee,
        role,
        isAuthenticated: true,
        loginStep: 'done',
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: extractApiError(err) });
    }
  },

  logout: () => {
    authApi.clearStoredAuth();
    try {
      localStorage.removeItem(ROLE_STORAGE_KEY);
    } catch {
      // ignore
    }
    set({
      employee: null,
      tenant: null,
      employees: [],
      selectedEmployee: null,
      role: 'EMPLOYE',
      isAuthenticated: false,
      isLoading: false,
      error: null,
      loginStep: 'tenant',
    });
  },

  checkAuth: () => {
    if (get().isAuthenticated && get().employee) return;

    const hasToken = authApi.hasStoredToken();
    const storedEmployee = authApi.getStoredEmployee();
    const storedTenant = authApi.getStoredTenant();
    const storedRole = _safeGetRole();

    if (hasToken && storedEmployee) {
      set({
        employee: storedEmployee,
        tenant: storedTenant,
        role: storedRole,
        isAuthenticated: true,
        loginStep: 'done',
      });
    } else if (storedTenant) {
      set({
        tenant: storedTenant,
        loginStep: 'employee',
      });
    }
  },

  clearError: () => set({ error: null }),
  resetLoginStep: () =>
    set({
      loginStep: 'tenant',
      tenant: null,
      employees: [],
      selectedEmployee: null,
      error: null,
    }),
}));
