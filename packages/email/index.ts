import { Resend } from "resend";
import { keys } from "./keys";

export const resend = keys().RESEND_TOKEN
  ? new Resend(keys().RESEND_TOKEN)
  : null;
