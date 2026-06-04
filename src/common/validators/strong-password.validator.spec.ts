import 'reflect-metadata';
import { validate } from 'class-validator';
import { IsStrongPassword } from './strong-password.validator.js';

class Target {
  @IsStrongPassword()
  password!: string;
}

async function firstErrorConstraints(password: string): Promise<string[]> {
  const dto = new Target();
  dto.password = password;
  const errors = await validate(dto);
  if (errors.length === 0) return [];
  return Object.keys(errors[0].constraints ?? {});
}

describe('IsStrongPassword', () => {
  it('accepts a password with upper, lower, digit, and symbol', async () => {
    expect(await firstErrorConstraints('Password1!')).toEqual([]);
  });

  it('rejects a password missing an uppercase letter', async () => {
    expect(await firstErrorConstraints('password1!')).toContain('matches');
  });

  it('rejects a password missing a lowercase letter', async () => {
    expect(await firstErrorConstraints('PASSWORD1!')).toContain('matches');
  });

  it('rejects a password missing a digit', async () => {
    expect(await firstErrorConstraints('Password!!')).toContain('matches');
  });

  it('rejects a password missing a special character', async () => {
    expect(await firstErrorConstraints('Password11')).toContain('matches');
  });

  it('rejects a password shorter than 8 characters', async () => {
    expect(await firstErrorConstraints('Pa1!')).toContain('minLength');
  });
});
