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
      ai_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          correlation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          metadata: Json
          property_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          metadata?: Json
          property_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          property_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      costs: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          description: string | null
          field_id: string
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          date?: string
          description?: string | null
          field_id: string
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          description?: string | null
          field_id?: string
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "costs_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostics: {
        Row: {
          created_at: string
          health_score: number
          id: string
          report: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          health_score?: number
          id?: string
          report?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          health_score?: number
          id?: string
          report?: Json
          user_id?: string
        }
        Relationships: []
      }
      fields: {
        Row: {
          area: number
          created_at: string
          crop: string
          estimated_yield: number | null
          id: string
          name: string
          planting_date: string | null
          property_id: string
          real_yield: number | null
          season: string | null
          user_id: string
        }
        Insert: {
          area?: number
          created_at?: string
          crop: string
          estimated_yield?: number | null
          id?: string
          name: string
          planting_date?: string | null
          property_id: string
          real_yield?: number | null
          season?: string | null
          user_id: string
        }
        Update: {
          area?: number
          created_at?: string
          crop?: string
          estimated_yield?: number | null
          id?: string
          name?: string
          planting_date?: string | null
          property_id?: string
          real_yield?: number | null
          season?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fields_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      intelligence_alerts: {
        Row: {
          action_label: string | null
          action_route: string | null
          alert_key: string
          created_at: string
          first_seen_at: string
          id: string
          impact: string | null
          last_seen_at: string
          message: string
          metric_name: string | null
          metric_value: string | null
          previous_value: string | null
          property_id: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_route?: string | null
          alert_key: string
          created_at?: string
          first_seen_at?: string
          id?: string
          impact?: string | null
          last_seen_at?: string
          message?: string
          metric_name?: string | null
          metric_value?: string | null
          previous_value?: string | null
          property_id?: string | null
          resolved_at?: string | null
          severity: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_route?: string | null
          alert_key?: string
          created_at?: string
          first_seen_at?: string
          id?: string
          impact?: string | null
          last_seen_at?: string
          message?: string
          metric_name?: string | null
          metric_value?: string | null
          previous_value?: string | null
          property_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intelligence_alerts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      prices: {
        Row: {
          created_at: string
          crop: string
          date: string
          id: string
          price_per_bag: number
          user_id: string
        }
        Insert: {
          created_at?: string
          crop: string
          date?: string
          id?: string
          price_per_bag?: number
          user_id: string
        }
        Update: {
          created_at?: string
          crop?: string
          date?: string
          id?: string
          price_per_bag?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          name?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          city: string | null
          created_at: string
          id: string
          name: string
          state: string | null
          total_area: number
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          id?: string
          name: string
          state?: string | null
          total_area?: number
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          id?: string
          name?: string
          state?: string | null
          total_area?: number
          user_id?: string
        }
        Relationships: []
      }
      simulated_scenarios: {
        Row: {
          created_at: string
          id: string
          metrics_snapshot: Json
          name: string
          property_id: string | null
          scenario_data: Json
          score_breakdown: Json
          simulated_score: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metrics_snapshot?: Json
          name: string
          property_id?: string | null
          scenario_data?: Json
          score_breakdown?: Json
          simulated_score?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metrics_snapshot?: Json
          name?: string
          property_id?: string | null
          scenario_data?: Json
          score_breakdown?: Json
          simulated_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulated_scenarios_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_rate_limit: {
        Args: { _day_limit: number; _event_type: string; _hour_limit: number }
        Returns: Json
      }
      record_audit_event: {
        Args: {
          _correlation_id?: string
          _entity_id?: string
          _entity_type?: string
          _event_type: string
          _metadata?: Json
          _property_id?: string
          _status?: string
        }
        Returns: string
      }
      record_usage_event: { Args: { _event_type: string }; Returns: undefined }
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
