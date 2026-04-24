import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function MatchesField(field: string, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'matchesField',
      target: (object as { constructor: new (...args: unknown[]) => unknown })
        .constructor,
      propertyName,
      constraints: [field],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedField] = args.constraints as [string];
          return (
            value === (args.object as Record<string, unknown>)[relatedField]
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must match ${args.constraints[0] as string}`;
        },
      },
    });
  };
}
