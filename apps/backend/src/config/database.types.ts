/**
 * Hand-written mirror of the Supabase schema defined in
 * `supabase/migrations/`. Keep in sync with those files, or regenerate with
 * `supabase gen types typescript` once the project is linked to a live
 * Supabase instance.
 */

export type ProfileRole = "owner" | "admin" | "member";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete";
export type DocumentJobStatus = "pending" | "processing" | "completed" | "failed" | "rejected_quota";
export type DocumentType = "invoice" | "receipt" | "identity_document" | "generic";
export type DocumentReviewStatus = "unreviewed" | "confirmed" | "rejected";

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          stripe_customer_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          stripe_customer_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          stripe_customer_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: ProfileRole;
          created_at: string;
        };
        Insert: {
          id: string;
          organization_id: string;
          email: string;
          role?: ProfileRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          email?: string;
          role?: ProfileRole;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          id: string;
          name: string;
          price_monthly: number;
          max_documents_per_month: number;
          max_pages_per_document: number;
          max_pages_per_month: number;
          max_file_size_mb: number;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          price_monthly?: number;
          max_documents_per_month: number;
          max_pages_per_document: number;
          max_pages_per_month: number;
          max_file_size_mb: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          price_monthly?: number;
          max_documents_per_month?: number;
          max_pages_per_document?: number;
          max_pages_per_month?: number;
          max_file_size_mb?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          organization_id: string;
          plan_id: string;
          status: SubscriptionStatus;
          current_period_start: string;
          current_period_end: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          plan_id: string;
          status?: SubscriptionStatus;
          current_period_start?: string;
          current_period_end: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          plan_id?: string;
          status?: SubscriptionStatus;
          current_period_start?: string;
          current_period_end?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      document_jobs: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          file_name: string;
          file_size_bytes: number;
          page_count: number | null;
          azure_operation_id: string | null;
          status: DocumentJobStatus;
          document_type: DocumentType;
          average_confidence: number | null;
          result_json: Record<string, unknown> | null;
          error_message: string | null;
          storage_path: string | null;
          review_status: DocumentReviewStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          file_name: string;
          file_size_bytes: number;
          page_count?: number | null;
          azure_operation_id?: string | null;
          status?: DocumentJobStatus;
          document_type?: DocumentType;
          average_confidence?: number | null;
          result_json?: Record<string, unknown> | null;
          error_message?: string | null;
          storage_path?: string | null;
          review_status?: DocumentReviewStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          file_name?: string;
          file_size_bytes?: number;
          page_count?: number | null;
          azure_operation_id?: string | null;
          status?: DocumentJobStatus;
          document_type?: DocumentType;
          average_confidence?: number | null;
          result_json?: Record<string, unknown> | null;
          error_message?: string | null;
          storage_path?: string | null;
          review_status?: DocumentReviewStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_jobs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_jobs_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_jobs_reviewed_by_fkey";
            columns: ["reviewed_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      document_field_corrections: {
        Row: {
          id: string;
          document_job_id: string;
          field_name: string;
          previous_value: string | null;
          new_value: string;
          edited_by: string | null;
          edited_at: string;
        };
        Insert: {
          id?: string;
          document_job_id: string;
          field_name: string;
          previous_value?: string | null;
          new_value: string;
          edited_by?: string | null;
          edited_at?: string;
        };
        Update: {
          id?: string;
          document_job_id?: string;
          field_name?: string;
          previous_value?: string | null;
          new_value?: string;
          edited_by?: string | null;
          edited_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_field_corrections_document_job_id_fkey";
            columns: ["document_job_id"];
            referencedRelation: "document_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_field_corrections_edited_by_fkey";
            columns: ["edited_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_organization_monthly_usage: {
        Args: { p_organization_id: string };
        Returns: number;
      };
      current_organization_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      get_organization_job_stats: {
        Args: { p_organization_id: string; p_since: string };
        Returns: { completed_jobs: number; failed_jobs: number; avg_processing_seconds: number | null }[];
      };
      get_organization_daily_job_counts: {
        Args: { p_organization_id: string; p_since: string };
        Returns: { day: string; job_count: number }[];
      };
    };
    Enums: {
      profile_role: ProfileRole;
      subscription_status: SubscriptionStatus;
      document_job_status: DocumentJobStatus;
      document_type: DocumentType;
      document_review_status: DocumentReviewStatus;
    };
  };
}
