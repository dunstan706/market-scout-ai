import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const WaitlistInput = z.object({
  email: z.string().trim().email().max(254),
  businessName: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  businessType: z.enum(["salon", "spa", "other"]).default("salon"),
});

export type WaitlistInput = z.infer<typeof WaitlistInput>;

export const joinWaitlist = createServerFn({ method: "POST" })
  .validator((input: unknown) => WaitlistInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { error } = await supabaseAdmin.from("waitlist_signups").insert({
        email: data.email.toLowerCase(),
        business_name: data.businessName || null,
        city: data.city || null,
        business_type: data.businessType,
      });

      if (error) {
        // 23505 = unique violation — already on the list, treat as success
        if (error.code === "23505") return { ok: true as const, duplicate: true as const };
        console.error("waitlist insert failed", error);
        throw new Error("Could not save your spot. Please try again.");
      }

      return { ok: true as const, duplicate: false as const };
    } catch (error) {
      // Covers missing Supabase credentials (e.g. local dev without .env) as
      // well as network or insert failures. Log the real reason server-side,
      // show the visitor a safe message instead of the raw error text.
      console.error("waitlist insert failed", error);
      throw new Error("Could not save your spot right now. Please try again shortly.");
    }
  });
