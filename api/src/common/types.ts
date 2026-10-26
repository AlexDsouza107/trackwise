export type Role = 'institution' | 'officer' | 'committee' | 'admin';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  institutionId: number | null;
}

export type ApplicationType = 'new_institution' | 'new_course' | 'intake_increase' | 'extension_of_approval';

export const APPLICATION_TYPES: ApplicationType[] = [
  'new_institution',
  'new_course',
  'intake_increase',
  'extension_of_approval',
];

export const TYPE_LABELS: Record<ApplicationType, string> = {
  new_institution: 'New Institution',
  new_course: 'New Course',
  intake_increase: 'Increase in Intake',
  extension_of_approval: 'Extension of Approval',
};

/** Documents required per application type (illustrative checklist, not the real AICTE list). */
export const REQUIRED_DOCUMENTS: Record<ApplicationType, string[]> = {
  new_institution: ['land_documents', 'society_registration', 'building_plan', 'financial_solvency', 'faculty_list', 'undertaking'],
  new_course: ['application_form', 'faculty_list', 'lab_inventory', 'curriculum', 'fee_structure'],
  intake_increase: ['application_form', 'faculty_list', 'infrastructure_certificate', 'previous_approval_letter', 'fee_structure'],
  extension_of_approval: ['application_form', 'previous_approval_letter', 'accreditation_certificate', 'audited_accounts', 'faculty_list', 'infrastructure_certificate'],
};
