import { IsString, validate } from 'class-validator';
import { MatchesField } from './matches-field.validator';

class TestDto {
  @IsString()
  password!: string;

  @IsString()
  @MatchesField('password', { message: 'confirm_password must match password' })
  confirm_password!: string;
}

async function validateDto(data: Partial<TestDto>) {
  const dto = Object.assign(new TestDto(), data);
  return validate(dto);
}

describe('MatchesField validator', () => {
  it('passes when both fields match', async () => {
    const errors = await validateDto({ password: 'secret', confirm_password: 'secret' });
    expect(errors).toHaveLength(0);
  });

  it('fails when fields do not match', async () => {
    const errors = await validateDto({ password: 'secret', confirm_password: 'different' });
    const confirmErrors = errors.find((e) => e.property === 'confirm_password');
    expect(confirmErrors).toBeDefined();
    expect(Object.values(confirmErrors!.constraints ?? {})).toEqual(
      expect.arrayContaining([expect.stringContaining('confirm_password')]),
    );
  });

  it('fails when confirm_password is undefined', async () => {
    const errors = await validateDto({ password: 'secret' });
    const confirmErrors = errors.find((e) => e.property === 'confirm_password');
    expect(confirmErrors).toBeDefined();
  });

  it('fails when password is empty string and confirm_password is not', async () => {
    const errors = await validateDto({ password: '', confirm_password: 'notempty' });
    const confirmErrors = errors.find((e) => e.property === 'confirm_password');
    expect(confirmErrors).toBeDefined();
  });
});
