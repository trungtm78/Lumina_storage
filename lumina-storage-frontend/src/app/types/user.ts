export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
  isActive: boolean;
  roles: string[];
}

export interface Role {
  id: string;
  name: string;
}
