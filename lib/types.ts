export type Patient = {
  id: string;
  name: string | null;
  calendar_aliases: string[] | null;
  icount_id: string | null;
  default_rate: number | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type PatientUpdate = {
  name: string;
  calendar_aliases: string[];
  icount_id: string;
  default_rate: number | null;
  phone: string;
  email: string;
  active: boolean;
};
