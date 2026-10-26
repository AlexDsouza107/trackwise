export interface Field { name: string; label: string; type: 'text' | 'number' | 'textarea' | 'date' | 'select'; options?: string[]; hint?: string; optional?: boolean }

export const TYPE_FIELDS: Record<string, Field[]> = {
  new_institution: [
    { name: 'programmes', label: 'Proposed programmes', type: 'text', hint: 'e.g. B.Tech CSE, B.Tech ECE' },
    { name: 'proposedIntake', label: 'Total proposed intake', type: 'number' },
    { name: 'facultyCount', label: 'Faculty available', type: 'number' },
    { name: 'studentCount', label: 'Planned student strength', type: 'number' },
    { name: 'builtUpSqm', label: 'Built-up area (sq m)', type: 'number' },
    { name: 'labCount', label: 'Laboratories', type: 'number' },
    { name: 'annualFee', label: 'Annual tuition fee (₹)', type: 'number' },
    { name: 'accreditationValidUntil', label: 'Accreditation valid until', type: 'date', optional: true },
  ],
  new_course: [
    { name: 'courseName', label: 'Course name', type: 'text' },
    { name: 'level', label: 'Level', type: 'select', options: ['Diploma', 'UG', 'PG'] },
    { name: 'intake', label: 'Proposed intake', type: 'number' },
  ],
  intake_increase: [
    { name: 'courseName', label: 'Course', type: 'text' },
    { name: 'currentIntake', label: 'Current intake', type: 'number' },
    { name: 'proposedIntake', label: 'Proposed intake', type: 'number' },
    { name: 'justification', label: 'Justification', type: 'textarea' },
  ],
  extension_of_approval: [
    { name: 'academicYear', label: 'Academic year', type: 'text', hint: 'e.g. 2026-27' },
    { name: 'yearsRequested', label: 'Years requested (1-5)', type: 'number' },
  ],
};
