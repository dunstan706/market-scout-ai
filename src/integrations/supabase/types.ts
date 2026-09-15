export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          amount: number
          created_at: string
          currency_code: string
          id: string
          payable_after: string
          payment_number: number
          payout_id: string | null
          referred_user_id: string
          status: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          amount: number
          created_at?: string
          currency_code?: string
          id?: string
          payable_after: string
          payment_number: number
          payout_id?: string | null
          referred_user_id: string
          status?: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          amount?: number
          created_at?: string
          currency_code?: string
          id?: string
          payable_after?: string
          payment_number?: number
          payout_id?: string | null
          referred_user_id?: string
          status?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_payouts: {
        Row: {
          affiliate_id: string
          amount: number
          created_at: string
          currency_code: string
          id: string
          paid_at: string
          reference: string | null
        }
        Insert: {
          affiliate_id: string
          amount: number
          created_at?: string
          currency_code?: string
          id?: string
          paid_at?: string
          reference?: string | null
        }
        Update: {
          affiliate_id?: string
          amount?: number
          created_at?: string
          currency_code?: string
          id?: string
          paid_at?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_referrals: {
        Row: {
          affiliate_id: string
          converted_at: string | null
          created_at: string
          id: string
          referred_email: string | null
          referred_user_id: string
          source_url: string | null
        }
        Insert: {
          affiliate_id: string
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_email?: string | null
          referred_user_id: string
          source_url?: string | null
        }
        Update: {
          affiliate_id?: string
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_email?: string | null
          referred_user_id?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          code: string
          created_at: string
          email: string
          id: string
          name: string | null
          payout_email: string | null
          payout_notes: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          id?: string
          name?: string | null
          payout_email?: string | null
          payout_notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          payout_email?: string | null
          payout_notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      briefs: {
        Row: {
          brief: Json
          business_id: string | null
          business_name: string
          business_type: string
          created_at: string
          emailed_at: string | null
          id: string
          location: string
          status: string
          week_start: string | null
          user_id: string
        }
        Insert: {
          brief: Json
          business_id?: string | null
          business_name: string
          business_type?: string
          created_at?: string
          emailed_at?: string | null
          id?: string
          location: string
          status?: string
          week_start?: string | null
          user_id: string
        }
        Update: {
          brief?: Json
          business_id?: string | null
          business_name?: string
          business_type?: string
          created_at?: string
          emailed_at?: string | null
          id?: string
          location?: string
          status?: string
          week_start?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          business_name: string
          business_type: string
          created_at: string
          google_place_id: string | null
          id: string
          is_primary: boolean
          location: string
          price_point: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_name: string
          business_type?: string
          created_at?: string
          google_place_id?: string | null
          id?: string
          is_primary?: boolean
          location: string
          price_point?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_name?: string
          business_type?: string
          created_at?: string
          google_place_id?: string | null
          id?: string
          is_primary?: boolean
          location?: string
          price_point?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      market_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_kind: string
          business_id: string
          competitor_name: string | null
          created_at: string
          detail: string | null
          email_sent_at: string | null
          headline: string
          id: string
          kind: string
          tone: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          alert_kind?: string
          business_id: string
          competitor_name?: string | null
          created_at?: string
          detail?: string | null
          email_sent_at?: string | null
          headline: string
          id?: string
          kind: string
          tone: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          alert_kind?: string
          business_id?: string
          competitor_name?: string | null
          created_at?: string
          detail?: string | null
          email_sent_at?: string | null
          headline?: string
          id?: string
          kind?: string
          tone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_alerts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_snapshots: {
        Row: {
          business_id: string | null
          business_name: string
          business_type: string
          created_at: string
          detected_changes: Json
          id: string
          location: string
          snapshot: Json
          user_id: string
        }
        Insert: {
          business_id?: string | null
          business_name: string
          business_type?: string
          created_at?: string
          detected_changes?: Json
          id?: string
          location: string
          snapshot: Json
          user_id: string
        }
        Update: {
          business_id?: string | null
          business_name?: string
          business_type?: string
          created_at?: string
          detected_changes?: Json
          id?: string
          location?: string
          snapshot?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_snapshots_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          billing_cadence: string | null
          business_name: string | null
          business_type: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          google_place_id: string | null
          id: string
          location: string | null
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan_tier: string
          price_point: string | null
          stripe_customer_id: string | null
          subscription_status: string | null
          updated_at: string
        }
        Insert: {
          billing_cadence?: string | null
          business_name?: string | null
          business_type?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          google_place_id?: string | null
          id: string
          location?: string | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan_tier?: string
          price_point?: string | null
          stripe_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Update: {
          billing_cadence?: string | null
          business_name?: string | null
          business_type?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          google_place_id?: string | null
          id?: string
          location?: string | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan_tier?: string
          price_point?: string | null
          stripe_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      waitlist_signups: {
        Row: {
          business_name: string | null
          business_type: string
          city: string | null
          created_at: string
          email: string
          id: string
          notes: string | null
          user_id: string | null
        }
        Insert: {
          business_name?: string | null
          business_type?: string
          city?: string | null
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          user_id?: string | null
        }
        Update: {
          business_name?: string | null
          business_type?: string
          city?: string | null
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      alert_rules: {
        Row: {
          business_id: string
          created_at: string
          enabled: boolean
          id: string
          rule_kind: string
          threshold: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          rule_kind: string
          threshold?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          rule_kind?: string
          threshold?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      competitor_events: {
        Row: {
          business_id: string
          competitor_id: string | null
          created_at: string
          detail: string | null
          event_kind: string
          id: string
          occurred_at: string
          source_label: string | null
          source_url: string | null
          title: string
          user_id: string
        }
        Insert: {
          business_id: string
          competitor_id?: string | null
          created_at?: string
          detail?: string | null
          event_kind: string
          id?: string
          occurred_at?: string
          source_label?: string | null
          source_url?: string | null
          title: string
          user_id: string
        }
        Update: {
          business_id?: string
          competitor_id?: string | null
          created_at?: string
          detail?: string | null
          event_kind?: string
          id?: string
          occurred_at?: string
          source_label?: string | null
          source_url?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      competitor_facts: {
        Row: {
          business_id: string
          competitor_id: string
          created_at: string
          effective_date: string | null
          field: string
          id: string
          needs_review: boolean
          source_label: string | null
          source_url: string | null
          status: string
          updated_at: string
          user_id: string
          value: string | null
        }
        Insert: {
          business_id: string
          competitor_id: string
          created_at?: string
          effective_date?: string | null
          field: string
          id?: string
          needs_review?: boolean
          source_label?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
          value?: string | null
        }
        Update: {
          business_id?: string
          competitor_id?: string
          created_at?: string
          effective_date?: string | null
          field?: string
          id?: string
          needs_review?: boolean
          source_label?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          value?: string | null
        }
        Relationships: []
      }
      competitors: {
        Row: {
          area: string | null
          business_id: string
          category: string | null
          created_at: string
          google_place_id: string | null
          id: string
          name: string
          notes: string | null
          status: string
          updated_at: string
          user_id: string
          website_url: string | null
        }
        Insert: {
          area?: string | null
          business_id: string
          category?: string | null
          created_at?: string
          google_place_id?: string | null
          id?: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
          website_url?: string | null
        }
        Update: {
          area?: string | null
          business_id?: string
          category?: string | null
          created_at?: string
          google_place_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          website_url?: string | null
        }
        Relationships: []
      }
      tracked_sources: {
        Row: {
          business_id: string
          competitor_id: string | null
          created_at: string
          id: string
          kind: string
          label: string
          last_checked_at: string | null
          last_error: string | null
          last_ok_at: string | null
          status: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          business_id: string
          competitor_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          last_ok_at?: string | null
          status?: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          business_id?: string
          competitor_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_ok_at?: string | null
          status?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_affiliate_commission: {
        Args: {
          p_event_time: string
          p_payment_amount: number
          p_payment_number: number
          p_referred_user_id: string
          p_subscription_start: string
          p_transaction_id: string
        }
        Returns: string
      }
      reverse_affiliate_commissions: {
        Args: { p_transaction_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
