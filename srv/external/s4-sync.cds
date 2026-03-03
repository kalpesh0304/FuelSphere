using { sap.common } from '@sap/cds/common';

@cds.external
@cds.persistence.skip
service S2A {

  entity A_CountryText {
    key Country  : String(3);
    key Language : String(2);

    CountryName          : String(60);
    NationalityName      : String(60);
    NationalityLongName  : String(60);

    to_Country : Association to A_Country;
  }

  entity A_Country {
    key Country : String(3);

    CountryCurrency          : String(5);
    CountryThreeLetterISOCode: String(3);
    CountryThreeDigitISOCode : String(3);
  }
}