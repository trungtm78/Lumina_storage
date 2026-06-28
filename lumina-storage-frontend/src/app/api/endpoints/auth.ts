import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  LoginRequest,
  RegisterRequest,
  SSOTokenResponse,
  TokenResponse,
  UserResponse,
} from "@/app/types/api";

const SSO_URL = import.meta.env.VITE_SSO_SERVICE_URL as string;

export const authApi = {
  login(data: LoginRequest) {
    return http.post<TokenResponse>(API_ENDPOINTS.auth.login, data, {
      skipAuth: true,
    });
  },

  register(data: RegisterRequest) {
    return http.post<UserResponse>(API_ENDPOINTS.auth.register, data);
  },

  refresh() {
    return http.post<TokenResponse>(
      API_ENDPOINTS.auth.refresh,
      {},
      { skipAuth: true }
    );
  },

  me() {
    return http.get<UserResponse>(API_ENDPOINTS.auth.me);
  },

  logout() {
    return http.post(API_ENDPOINTS.auth.logout);
  },


  async ssoExchange(data: { sso_code: string }): Promise<SSOTokenResponse> {
    const resp = await fetch(`${SSO_URL}/auth/sso/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sso_code: data.sso_code }),
    });
    if (!resp.ok) throw new Error("SSO token exchange failed");
    const json = await resp.json() as { session_token: string; keycloak_id_token?: string };
    return {
      access_token: json.session_token,
      keycloak_id_token: json.keycloak_id_token ?? "",
    };
  },
};
